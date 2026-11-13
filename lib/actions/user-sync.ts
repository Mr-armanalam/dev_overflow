import User from "@/database/user.model";
import Question from "@/database/question.model";
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

    const user = await User.findOneAndDelete({ clerkId });

    if (!user) {
      throw new Error("User not found");
    }

    // const userQuestionIds =
    await Question.find({ author: user._id }).distinct("_id");

    await Question.deleteMany({ author: user._id });

    ///////////// Delete usr comment and anser ///////////////

    // const deletedUser =
    await User.findByIdAndDelete(user._id);

    return user;
  } catch (error) {
    console.log(error);
    throw error;
  }
}
