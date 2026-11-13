/* eslint-disable spaced-comment */
"use server";

import Answer from "@/database/answer.model";
import { connectToDatabase } from "../mongoose";
import { AnswerVoteParams, CreateAnswerParams, GetAnswersParams } from "./shared.types";
import Question from "@/database/question.model";
import { revalidatePath } from "next/cache";
import User from "@/database/user.model";
import Interaction from "@/database/interaction.model";
import { getAuthenticatedUser, isSameId } from "@/lib/auth";

export async function createAnswer(params: CreateAnswerParams) {
  try {
    await connectToDatabase();

    // The author is always the signed-in user — never a client-supplied id.
    const mongoUser = await getAuthenticatedUser();
    const author = mongoUser._id;

    const { content, question, path } = params;
    // const newAnswer = new Answer({ content, author, question });

    const newAnswer = await Answer.create({ content, author, question });

    // Add the answer to the question's answer array
    const questionObject = await Question.findByIdAndUpdate(question, {
      $push: { answers: newAnswer._id },
    });

    await Interaction.create({
      user: author,
      action: "answer",
      question,
      answer: newAnswer._id,
      tags: questionObject.tags
    });

    await User.findByIdAndUpdate(author, { $inc: { reputation: 10 }})

    revalidatePath(path);
  } catch (error) {    
    console.log(error);
    throw error;
  }
}

export async function getAnswers(params: GetAnswersParams) {
  try {
    await connectToDatabase();

    const { questionId, sortBy, page = 1, pageSize = 10 } = params;  
    const skipAmount = (page - 1) * pageSize;
    
    let sortOptions = {};

    switch (sortBy) {
      case "highestUpvotes":
        sortOptions = { upvotes: -1}
        break;
      case "lowestUpvotes":
        sortOptions = { upvotes: 1}
        break;
      case "recent":
        sortOptions = { createdAt: -1}
        break;
      case "old":
        sortOptions = { createdAt: 1}
        break;
    
      default:
        break;
    }

    const answers = await Answer.find({question: questionId })   /////////////// edited /////////////////
      .populate({path: "author", model: User , select: "_id clerkId name picture"})
      .sort(sortOptions)
      .skip(skipAmount)
      .limit(pageSize);

      const totalAnswers = await Answer.countDocuments({question: questionId});

    const isNext = totalAnswers > skipAmount + answers.length;
      
    return { answers ,isNext};
  } catch (error) {
    console.log(error);
    throw error;
  }
}

export async function upvoteAnswer(params: AnswerVoteParams): Promise<{ success: boolean; error?: string }> {
  try {
      await connectToDatabase();

      const mongoUser = await getAuthenticatedUser();
      const userId = mongoUser._id;

      const { answerId, hasupVoted, hasdownVoted, path } = params;

      // Load first so the self-vote check runs BEFORE any write.
      const existingAnswer = await Answer.findById(answerId);

      if(!existingAnswer) {
        throw new Error('Answer not found');
      }

      if (isSameId(existingAnswer.author, userId)) {
        // Expected user error, not an exception: return it so the
        // client can show a toast instead of a runtime-error overlay.
        return { success: false, error: "You cannot vote on your own answer" };
      }

      let updateQuery = {};

      if(hasupVoted) {
        updateQuery = { $pull: { upvotes: userId}}
      }else if(hasdownVoted) {
        updateQuery = {
          $pull: { downvotes: userId},
          $push: { upvotes: userId}
        }
      }else {
        updateQuery = { $addToSet: { upvotes: userId}}
      }

      const answer = await Answer.findByIdAndUpdate(
        answerId, updateQuery, {new: true}
      )

      if(!answer) {
        throw new Error('Answer not found');
      }

      /////////////// Increment author's reputation //////////////////
      await User.findByIdAndUpdate(userId, {
        $inc: { reputation: hasupVoted ? -2: 2}
      })

      await User.findByIdAndUpdate(answer.author, {
        $inc: { reputation: hasupVoted? -10: 10}
      })

      revalidatePath(path);
      return { success: true };

  } catch (error) {
      console.log(error);
      throw error 
  }
}

export async function downvoteAnswer(params: AnswerVoteParams): Promise<{ success: boolean; error?: string }> {
  try {
      await connectToDatabase();

      const mongoUser = await getAuthenticatedUser();
      const userId = mongoUser._id;

      const { answerId, hasupVoted, hasdownVoted, path } = params;

      // Load first so the self-vote check runs BEFORE any write.
      const existingAnswer = await Answer.findById(answerId);

      if(!existingAnswer) {
        throw new Error('Answer not found');
      }

      if (isSameId(existingAnswer.author, userId)) {
        // Expected user error, not an exception: return it so the
        // client can show a toast instead of a runtime-error overlay.
        return { success: false, error: "You cannot vote on your own answer" };
      }

      let updateQuery = {};

      if(hasdownVoted) {
        updateQuery = { $pull: { downvotes: userId}}
      }else if(hasupVoted) {
        updateQuery = {
          $pull: { upvotes: userId},
          $push: { downvotes: userId}
        }
      }else {
        updateQuery = { $addToSet: { downvotes: userId}}
      }

      const answer = await Answer.findByIdAndUpdate(
        answerId, updateQuery, {new: true}
      )

      if(!answer) {
        throw new Error('Answer not found');
      }

      /////////////// Increment author's reputation //////////////////
      // Mirror the upvote logic with the opposite signs: a new downvote
      // costs the voter 2 and the author 10; removing a downvote refunds
      // both. (Previously both branches were inverted.)
      await User.findByIdAndUpdate(userId, {
        $inc: { reputation: hasdownVoted ? 2 : -2 }
      })

      await User.findByIdAndUpdate(answer.author, {
        $inc: { reputation: hasdownVoted ? 10 : -10 }
      })

      revalidatePath(path);
      return { success: true };

  } catch (error) {
      console.log(error);
      throw error 
  }
}
