import User from "@/database/user.model";
import Question from "@/database/question.model";
import Answer from "@/database/answer.model";
import Interaction from "@/database/interaction.model";
import { connectToDatabase } from "../mongoose";
import { revalidatePath } from "next/cache";
import {
  CreateUserParams,
  DeleteUserParams,
  UpdateUserParams,
} from "./shared.types";

/**
 * Webhook-only user sync (Clerk -> MongoDB).
 *
 * This module deliberately has NO "use server" directive: these functions
 * are trusted server-to-server operations, verified by the Svix webhook
 * signature in app/api/webhook/route.ts. They must NOT be exported from
 * a server-action file, where any signed-in client could invoke
 * createUser/deleteUser directly.
 */
export async function createUser(userData: CreateUserParams) {
  try {
    await connectToDatabase();

    const newUser = await User.create(userData);

    return newUser;
  } catch (error) {
    console.log(error);
    throw error;
  }
}

export async function updateUser(params: UpdateUserParams) {
  try {
    await connectToDatabase();

    const { clerkId, updateData, path } = params;

    await User.findOneAndUpdate({ clerkId }, updateData, { returnDocument: 'after' });

    revalidatePath(path);
  } catch (error) {
    console.log(error);
    throw error;
  }
}

export async function deleteUser(params: DeleteUserParams) {
  try {
    await connectToDatabase();

    const { clerkId } = params;

    // findOneAndDelete already deletes the user — exactly once.
    // (Previously a second findByIdAndDelete ran afterwards.)
    const user = await User.findOneAndDelete({ clerkId });

    if (!user) {
      throw new Error("User not found");
    }

    const userQuestionIds = await Question.find({ author: user._id }).distinct("_id");

    // The user's own answers, plus answers on the questions being
    // deleted (otherwise they would be orphaned).
    await Answer.deleteMany({
      $or: [
        { author: user._id },
        { question: { $in: userQuestionIds } },
      ],
    });

    // The user's interactions (views, votes, asks) ...
    await Interaction.deleteMany({ user: user._id });

    await Question.deleteMany({ author: user._id });

    // ... and remove them from other users' saved lists.
    await User.updateMany(
      { saved: user._id },
      { $pull: { saved: user._id } }
    );

    return user;
  } catch (error) {
    console.log(error);
    throw error;
  }
}
