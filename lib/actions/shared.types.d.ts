import { IUser } from "@/database/user.model";
import type { UserRole } from "@/lib/auth/permissions";

export interface CreateAnswerParams {
  content: string;
  // NOTE: no `author` — the author is derived from the Clerk session
  // inside createAnswer. Never accept it from the client.
  question: string; // Question ID
  path: string;
  /** True when the content came from an AI draft. AI-assisted answers
   *  earn no reputation (Arman's decision, 13 Nov 2026) and render an
   *  "AI-assisted" badge. */
  aiAssisted?: boolean;
}
export interface GetAnswersParams {
  questionId: string;
  sortBy?: string | string[];
  page?: number;
  pageSize?: number;
}
export interface AnswerVoteParams {
  answerId: string;
  // NOTE: no `userId` — the voter is derived from the Clerk session
  // inside the vote actions. Never accept it from the client.
  hasupVoted: boolean;
  hasdownVoted: boolean;
  path: string;
}
export interface DeleteAnswerParams {
  answerId: string;
  path: string;
}
export interface SearchParams {
  query?: string | null;
  type?: string | null;
}
export interface RecommendedParams {
  userId: string;
  page?: number;
  pageSize?: number;
  searchQuery?: string;
}
export interface ViewQuestionParams {
  questionId: string;
  userId: string | undefined;
}
export interface JobFilterParams {
  query: string;
  page: string;
}
export interface GetQuestionsParams {
  page?: number;
  pageSize?: number;
  searchQuery?: string;
  filter?: string;
}
export interface CreateQuestionParams {
  title: string;
  content: string;
  tags: string[];
  // NOTE: no `author` — the author is derived from the Clerk session
  // inside createQuestion. Never accept it from the client.
  path: string;
}
export interface GetQuestionByIdParams {
  questionId: string;
}
export interface QuestionVoteParams {
  questionId: string;
  // NOTE: no `userId` — the voter is derived from the Clerk session
  // inside the vote actions. Never accept it from the client.
  hasupVoted: boolean;
  hasdownVoted: boolean;
  path: string;
}
export interface DeleteQuestionParams {
  questionId: string;
  path: string;
}
export interface EditQuestionParams {
  questionId: string;
  title: string;
  content: string;
  path: string;
}
export interface GetAllTagsParams {
  page?: number;
  pageSize?: number;
  filter?: string;
  searchQuery?: string;
}
export interface GetQuestionsByTagIdParams {
  tagId: string;
  page?: number;
  pageSize?: number;
  searchQuery?: string;
}
export interface GetTopInteractedTagsParams {
  userId: string;
  limit?: number;
}
export interface CreateUserParams {
  clerkId: string;
  name: string;
  username: string;
  email: string;
  picture: string;
  /** RBAC role, synced from Clerk `publicMetadata.role` by the webhook.
   *  Defaults to "user" in the schema when omitted. */
  role?: UserRole;
}
export interface GetUserByIdParams {
  userId: string | null;
}
export interface GetAllUsersParams {
  page?: number;
  pageSize?: number;
  filter?: string;
  searchQuery?: string; // Add searchQuery parameter
}
export interface UpdateUserParams {
  clerkId: string;
  updateData: Partial<IUser>;
  path: string;
}
export interface ToggleSaveQuestionParams {
  // NOTE: no `userId` — the acting user is derived from the Clerk
  // session inside toggleSaveQuestion. Never accept it from the client.
  questionId: string;
  path: string;
}
export interface GetSavedQuestionsParams {
  clerkId: string;
  page?: number;
  pageSize?: number;
  filter?: string;
  searchQuery?: string;
}
export interface GetUserStatsParams {
  userId: string;
  page?: number;
  pageSize?: number;
}
export interface DeleteUserParams {
  clerkId: string;
}
