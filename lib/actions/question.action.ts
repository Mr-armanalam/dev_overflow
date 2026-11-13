/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable spaced-comment */
"use server";
import { FilterQuery, type Types } from "mongoose";
import Question from "@/database/question.model";
import Tag from "@/database/tag.model";
import { connectToDatabase } from "../mongoose";
import { CreateQuestionParams,  DeleteAnswerParams, DeleteQuestionParams, EditQuestionParams,
          GetQuestionByIdParams, GetQuestionsParams, QuestionVoteParams, 
          RecommendedParams} from "./shared.types";
import User from "@/database/user.model";
import { revalidatePath } from "next/cache";
import Answer from "@/database/answer.model";
import Interaction from "@/database/interaction.model";
import { getAuthenticatedUser, isSameId } from "@/lib/auth";
import {
  deleteChunksFor,
  indexQuestion,
} from "@/lib/ai/rag/index";

export async function getQuestions(params: GetQuestionsParams) {
  try {
    await connectToDatabase();

    const { searchQuery, filter, page = 1, pageSize = 20 } = params;

    /////////////////// Calculate the number of posts to skip based on the page number and page size /////////////////

    const skipAmount = (page - 1) * pageSize;

    const query : FilterQuery<typeof Question> = {};
    if (searchQuery) {
      query.$or = [
        { title: { $regex: new RegExp(searchQuery, "i") }},
        { content: { $regex: new RegExp(searchQuery, "i") }},
      ]
    }

    let sortOptions = {};

    switch (filter) {
      case "newest":
        sortOptions = { createdAt: -1}
       break;
      case "frequent":
        sortOptions = { views: -1}
        break;
      case "unanswered":
        query.answers = { $size: 0}
        break;
      default:
        break;
    }

    const questions = await Question.find(query)
      .populate({ path: "tags", model: Tag })
      .populate({ path: "author", model: User })
      .skip(skipAmount)
      .limit(pageSize)
      .sort(sortOptions);

    const totalQustions = await Question.countDocuments(query);

    const isNext = totalQustions > skipAmount + questions.length;

    return { questions, isNext };
  } catch (error) {
    console.log(error);
    throw error;
  }
}
export async function createQuestion(params: CreateQuestionParams) {
  try {
    await connectToDatabase();

    // The author is always the signed-in user — never a client-supplied id.
    const mongoUser = await getAuthenticatedUser();
    const author = mongoUser._id;

    const { title, content, tags, path } = params;

    const tagDocuments = [];

    //////////////////////////////////// Extra but usefull ////////////////////////////////////////////////////////////

    // Create the tags or get their ObjectId if they already exist
    // for (const tag of tags) {

    //   const existingTag = await Tag.findOneAndUpdate(
    //     { name: { $regex: new RegExp(`^${tag}$`, "i") } }, // finding parameter by regular expression with case insensitive
    //     { $setOnInsert: { name: tag }, $push: { questions: new mongoose.Types.ObjectId() } }, // on it
    //     { upsert: true, new: true, setDefaultsOnInsert: true } // additional provide information (to create a new tag if no match found)
    //   );

    //   tagDocuments.push(existingTag._id);

    // }

    // const question = await Question.create({ title, content, tags: tagDocuments, author });

    /////////////////////////////////// End ////////////////////////////////////////////////////////////////////////

    const question = await Question.create({ title, content, author });

    for (const tag of tags) {
      const existingTag = await Tag.findOneAndUpdate(
        { name: { $regex: new RegExp(`^${tag}$`, "i") } },
        { $setOnInsert: { name: tag }, $push: { questions: question._id } },
        { upsert: true, new: true }
      );

      tagDocuments.push(existingTag._id);
    }

    await Question.findByIdAndUpdate(question._id, {
      $push: { tags: { $each: tagDocuments } },
    });

    ////////////// Create an interaction record for the user's ask_question action ///////////////////
    await Interaction.create({
      user: author,
      action: "ask_question",
      question: question._id,
      tags: tagDocuments
    });
    ////////////// Increment author's reputation by +5 for creating a question ///////////////////
    await User.findByIdAndUpdate(author, { $inc: { reputation: 5 } });

    revalidatePath(path);

    // RAG index-on-write (design §5.3): fire-and-forget — indexQuestion
    // never throws, and a failure is logged to AiUsageLog, so indexing
    // can never break asking a question.
    void indexQuestion(question._id, author as Types.ObjectId);

    // The id is returned so the ask-question form can link a recorded
    // AI duplicate suggestion to the submitted question (P3 queue).
    return { questionId: String(question._id) };
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function getQuestionsById(params: GetQuestionByIdParams) {
  try {
    await connectToDatabase();

    const { questionId } = params;

    const question = await Question.findById(questionId)
      .populate({ path: "tags", model: Tag, select: "_id name" })
      .populate({
        path: "author",
        model: User,
        select: "_id clerkId name picture",
      });

    return question;
  } catch (error) {
    console.log(error);
    throw error;
  }
}

export async function upvoteQuestion(params: QuestionVoteParams): Promise<{ success: boolean; error?: string }> {
  try {
    await connectToDatabase();

    const mongoUser = await getAuthenticatedUser();
    const userId = mongoUser._id;

    const { questionId, hasupVoted, hasdownVoted, path } = params;

    // Load first so the self-vote check runs BEFORE any write.
    const existingQuestion = await Question.findById(questionId);

    if (!existingQuestion) {
      throw new Error("Question not found");
    }

    if (isSameId(existingQuestion.author, userId)) {
      // Expected user error, not an exception: return it so the client
      // can show a toast. Throwing here surfaces as a full-screen
      // Next.js runtime-error overlay in the browser.
      return { success: false, error: "You cannot vote on your own question" };
    }

    let updateQuery = {};

    if (hasupVoted) {
      updateQuery = { $pull: { upvotes: userId } };
    } else if (hasdownVoted) {
      updateQuery = {
        $pull: { downvotes: userId },
        $push: { upvotes: userId },
      };
    } else {
      updateQuery = { $addToSet: { upvotes: userId } };
    }

    const question = await Question.findByIdAndUpdate(questionId, updateQuery, {
      new: true,
    });

    if (!question) {
      throw new Error("Question not found");
    }

    /////////////// Increment author's reputation by +1/-1 for upvoting/revoking an upvote to the question //////////////////
    await User.findByIdAndUpdate(userId, { $inc: { reputation: hasupVoted ? -1 : 1 } },)

    ////////////// Increment author's reputation by +10/-10 for recieving an upvote to the question //////////////////
    await User.findByIdAndUpdate(question.author, { $inc: { reputation: hasupVoted ? -10 : 10 } })

    revalidatePath(path);
    return { success: true };
  } catch (error) {
    console.log(error);
    throw error;
  }
}
export async function downvoteQuestion(params: QuestionVoteParams): Promise<{ success: boolean; error?: string }> {
  try {
    await connectToDatabase();

    const mongoUser = await getAuthenticatedUser();
    const userId = mongoUser._id;

    const { questionId, hasupVoted, hasdownVoted, path } = params;

    // Load first so the self-vote check runs BEFORE any write.
    const existingQuestion = await Question.findById(questionId);

    if (!existingQuestion) {
      throw new Error("Question not found");
    }

    if (isSameId(existingQuestion.author, userId)) {
      throw new Error("You cannot vote on your own question");
    }

    let updateQuery = {};

    if (hasdownVoted) {
      updateQuery = { $pull: { downvotes: userId } };
    } else if (hasupVoted) {
      updateQuery = {
        $pull: { upvotes: userId },
        $push: { downvotes: userId },
      };
    } else {
      updateQuery = { $addToSet: { downvotes: userId } };
    }

    const question = await Question.findByIdAndUpdate(questionId, updateQuery, {
      new: true,
    });

    if (!question) {
      throw new Error("Question not found");
    }

    /////////////// Increment author's reputation //////////////////
    await User.findByIdAndUpdate(userId, {
      $inc: { reputation: hasupVoted ? -2: 2}
    })

    await User.findByIdAndUpdate(question.author, {
      $inc: { reputation: hasdownVoted? -10: 10}
    })

    revalidatePath(path);
    return { success: true };
  } catch (error) {
    console.log(error);
    throw error;
  }
}

export async function deleteQuestion(params: DeleteQuestionParams) {
  try {
    await connectToDatabase();

    const mongoUser = await getAuthenticatedUser();

    const { questionId, path } = params;

    const question = await Question.findById(questionId);

    if (!question) {
      throw new Error("Question not found");
    }

    if (!isSameId(question.author, mongoUser._id)) {
      throw new Error("Forbidden: only the author can delete this question");
    }

    await Question.deleteOne({ _id: questionId });
    await Answer.deleteMany({ question: questionId });
    await Interaction.deleteMany({ question: questionId });
    await Tag.updateMany({ question: questionId },{ $pull: { questions: questionId } });

    // RAG: drop the question's chunks (fire-and-forget, never throws).
    void deleteChunksFor(questionId);

    revalidatePath(path);
  } catch (error) {
    console.log(error);
    throw error;
  }
}
export async function deleteAnswer(params: DeleteAnswerParams) {
  try {
    await connectToDatabase();

    const mongoUser = await getAuthenticatedUser();

    const { answerId, path } = params;

    const answer = await Answer.findById(answerId ); 

    if(!answer) {
      throw new Error("Answer not found");
    }

    if (!isSameId(answer.author, mongoUser._id)) {
      throw new Error("Forbidden: only the author can delete this answer");
    }
    await Answer.deleteOne({_id: answerId}); //////////////////////////////////////////////////////////////////
    await Question.updateMany({ _id: answer.question },{ $pull: { answers: answerId } });
    await Interaction.deleteMany({ answer: answerId });

    // RAG: drop this answer's chunk (fire-and-forget, never throws).
    void deleteChunksFor(answerId);

    revalidatePath(path);
  } catch (error) {
    console.log(error);
    throw error;
  }
}
export async function editQuestion(params: EditQuestionParams) {
  try {
    await connectToDatabase();

    const mongoUser = await getAuthenticatedUser();

    const { questionId, title, content, path } = params;

    const question = await Question.findById(questionId).populate("tags");

    if(!question) throw new Error("Question not found");

    if (!isSameId(question.author, mongoUser._id)) {
      throw new Error("Forbidden: only the author can edit this question");
    }

    question.title = title;
    question.content = content;

    await question.save();

    // RAG: re-embed the edited question (fire-and-forget, never throws).
    void indexQuestion(questionId, mongoUser._id as Types.ObjectId);

    revalidatePath(path);
   
  } catch (error) {
    console.log(error);
    throw error;
  }
}

export async function getHotQuestions() {
    try {
        await connectToDatabase();

        const hotQuestions = await Question.find({})
        .sort({ views: -1, upvotes: -1 })   /////////// descending order //////////
        .limit(5);

        return hotQuestions;

    } catch (error) {
        console.log(error);
        throw error 
    }
}

export async function getRecommentedQuestions(params: RecommendedParams){
  try {
    await connectToDatabase();

    const { userId, page = 1, pageSize = 28 , searchQuery } = params;

    const user = await User.findOne({ clerkId: userId});

    if(!user) {
      throw new Error("User not found");
    }

    const skipAmount = (page-1)*pageSize;

    const userInteractions = await Interaction.find({ user: user._id})
    .populate("tags")
    .exec();

    const userTags = userInteractions.reduce((tags, interaction) => {
      if(interaction.tags) {
        tags = tags.concat(interaction.tags);
      }
      return tags;
    },[]);

    const distinctUserTagIds = [
      ...new Set(userTags.map((tag: any) => tag._id)),
    ];

    const query: FilterQuery<typeof Question> = {
      $and: [
        { tags: {$in: distinctUserTagIds}},  /////////// Question with user tags ///////////////
        { author: {$ne: user._id}}, ///////////// Exclude user's own questions ///////////////
      ]
    };

    if(searchQuery) {
      query.$or = [
        { $title: { $regex: searchQuery, $options: "i"} },
        { content: { $regex: searchQuery, $options: "i"}}
      ];
    }

    const totalQustions = await Question.countDocuments(query);
    
    const recommendedQuestions = await Question.find(query)
    .populate({
      path: 'tags',
      model: Tag
    })
    .populate({
      path: 'author',
      model: User
    })
    .skip(skipAmount)
    .limit(pageSize);

    const isNext = totalQustions > recommendedQuestions.length;

    return { questions: recommendedQuestions, isNext}

  } catch (error) {
    console.log("Error getting recommended questions:",error);
    throw error
  }
}