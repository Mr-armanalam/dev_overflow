import { auth } from "@clerk/nextjs/server";
import User, { type IUser } from "@/database/user.model";
import { connectToDatabase } from "./mongoose";

/**
 * Resolve the acting user from the Clerk session — never from a
 * client-supplied userId/clerkId parameter. Server actions that mutate
 * data must call this first and use the returned Mongo user.
 *
 * @throws Error("Unauthorized: ...") when there is no signed-in user.
 * @throws Error("User not found") when the Clerk user has not been
 * synced to MongoDB yet (Clerk webhook).
 */
export async function getAuthenticatedUser(): Promise<IUser> {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    throw new Error("Unauthorized: please sign in");
  }

  await connectToDatabase();

  const mongoUser = await User.findOne({ clerkId });

  if (!mongoUser) {
    throw new Error("User not found");
  }

  return mongoUser;
}

/** Compare two Mongo ObjectIds (or their string forms) by value. */
export function isSameId(a: unknown, b: unknown): boolean {
  return String(a) === String(b);
}
