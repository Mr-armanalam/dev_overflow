/**
 * Integration tests for the core Q&A flows against a real MongoDB
 * (mongodb-memory-server). These prove the queries the mocked unit
 * tests assert actually work against Mongoose: documents are created,
 * linked, voted on and cleaned up, and the reputation deltas land.
 *
 * Stubbed, not real: Clerk auth (`@/lib/auth` returns a user created
 * in the test DB), `next/cache` revalidation, the RAG index-on-write
 * hooks (they would call the Gemini API) and the AI-draft marker.
 * Everything else — models, queries, updates — is real.
 *
 * First run downloads a mongod binary (~60 MB) into
 * ~/.cache/mongodb-binaries; later runs reuse it.
 */
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidate: vi.fn(),
  indexQuestion: vi.fn(),
  indexAnswer: vi.fn(),
  deleteChunksFor: vi.fn(),
  markAiDraftUsed: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthenticatedUser: mocks.auth,
  isSameId: (a: unknown, b: unknown) => String(a) === String(b),
}));
// The test connects mongoose to the memory server directly in
// beforeAll; the actions' connectToDatabase is a no-op here.
vi.mock("@/lib/mongoose", () => ({ connectToDatabase: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/ai/rag/index", () => ({
  indexQuestion: mocks.indexQuestion,
  indexAnswer: mocks.indexAnswer,
  deleteChunksFor: mocks.deleteChunksFor,
}));
vi.mock("@/lib/ai/drafts", () => ({
  markAiDraftUsed: mocks.markAiDraftUsed,
}));

import Answer from "@/database/answer.model";
import Interaction from "@/database/interaction.model";
import Question from "@/database/question.model";
import Tag from "@/database/tag.model";
import User from "@/database/user.model";
import { createAnswer, downvoteAnswer, getAnswers, upvoteAnswer } from "./answer.action";
import { viewQuestion } from "./interaction.action";
import {
  createQuestion,
  deleteQuestion,
  getQuestions,
  getRecommentedQuestions,
  upvoteQuestion,
} from "./question.action";
import { toggleSaveQuestion } from "./user.action";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Question.deleteMany({}),
    Answer.deleteMany({}),
    Tag.deleteMany({}),
    Interaction.deleteMany({}),
  ]);
  vi.clearAllMocks();
});

async function makeUser(clerkId: string, username: string) {
  return User.create({
    clerkId,
    name: username,
    username,
    email: `${username}@example.com`,
    picture: "https://example.com/pic.png",
  });
}

async function askQuestion(author: { _id: unknown }, tags: string[]) {
  mocks.auth.mockResolvedValue(author);
  const { questionId } = await createQuestion({
    title: "How do I use useState in React?",
    content: "x".repeat(120),
    tags,
    path: "/",
  });
  return questionId;
}

describe("full Q&A flow", () => {
  it("ask -> answer -> upvote lands the right documents and reputation", async () => {
    const author = await makeUser("clerk_author", "author");
    const voter = await makeUser("clerk_voter", "voter");

    const questionId = await askQuestion(author, ["react", "hooks"]);
    const question = await Question.findById(questionId);
    expect(question).not.toBeNull();
    expect(question?.tags).toHaveLength(2);
    expect(await Tag.countDocuments({})).toBe(2);
    expect(await Interaction.countDocuments({ action: "ask_question" })).toBe(1);
    expect((await User.findById(author._id))?.reputation).toBe(5);

    mocks.auth.mockResolvedValue(author);
    await createAnswer({
      content: "y".repeat(120),
      question: questionId,
      path: `/question/${questionId}`,
    });
    const answer = await Answer.findOne({ question: questionId });
    expect(answer).not.toBeNull();
    expect((await Question.findById(questionId))?.answers).toHaveLength(1);
    expect((await User.findById(author._id))?.reputation).toBe(15);

    mocks.auth.mockResolvedValue(voter);
    const vote = await upvoteAnswer({
      answerId: String(answer?._id),
      hasupVoted: false,
      hasdownVoted: false,
      path: "/",
    });
    expect(vote).toEqual({ success: true });
    expect((await User.findById(voter._id))?.reputation).toBe(2);
    expect((await User.findById(author._id))?.reputation).toBe(25);
    expect(
      (await Answer.findById(answer?._id))?.upvotes.map(String),
    ).toContain(String(voter._id));

    const { questions } = await getQuestions({ searchQuery: "useState" });
    expect(questions).toHaveLength(1);
    const { answers } = await getAnswers({
      questionId,
      sortBy: "highestUpvotes",
    });
    expect(answers).toHaveLength(1);
  });

  it("an AI-assisted answer earns no reputation", async () => {
    const author = await makeUser("clerk_author", "author");
    const questionId = await askQuestion(author, ["react"]);

    mocks.auth.mockResolvedValue(author);
    await createAnswer({
      content: "y".repeat(120),
      question: questionId,
      path: "/",
      aiAssisted: true,
    });

    expect((await User.findById(author._id))?.reputation).toBe(5);
    expect(mocks.markAiDraftUsed).toHaveBeenCalled();
  });

  it("question upvote and downvote move reputation as implemented", async () => {
    const author = await makeUser("clerk_author", "author");
    const voter = await makeUser("clerk_voter", "voter");
    const questionId = await askQuestion(author, ["react"]);

    mocks.auth.mockResolvedValue(voter);
    await upvoteQuestion({
      questionId,
      hasupVoted: false,
      hasdownVoted: false,
      path: "/",
    });
    expect((await User.findById(voter._id))?.reputation).toBe(1);
    expect((await User.findById(author._id))?.reputation).toBe(15);

    // Removing the upvote refunds both sides.
    await upvoteQuestion({
      questionId,
      hasupVoted: true,
      hasdownVoted: false,
      path: "/",
    });
    expect((await User.findById(voter._id))?.reputation).toBe(0);
    expect((await User.findById(author._id))?.reputation).toBe(5);
  });

  it("a self-vote on a question is rejected without writing", async () => {
    const author = await makeUser("clerk_author", "author");
    const questionId = await askQuestion(author, ["react"]);

    mocks.auth.mockResolvedValue(author);
    const result = await upvoteQuestion({
      questionId,
      hasupVoted: false,
      hasdownVoted: false,
      path: "/",
    });

    expect(result).toEqual({
      success: false,
      error: "You cannot vote on your own question",
    });
    expect(
      (await Question.findById(questionId))?.upvotes,
    ).toHaveLength(0);
  });

  it("deleting a question removes its answers and interactions", async () => {
    const author = await makeUser("clerk_author", "author");
    const questionId = await askQuestion(author, ["react"]);
    mocks.auth.mockResolvedValue(author);
    await createAnswer({
      content: "y".repeat(120),
      question: questionId,
      path: "/",
    });

    await deleteQuestion({ questionId, path: "/" });

    expect(await Question.countDocuments({})).toBe(0);
    expect(await Answer.countDocuments({})).toBe(0);
    expect(await Interaction.countDocuments({ question: questionId })).toBe(0);
  });
});

describe("views and recommendations", () => {
  it("counts a view once per user, not once per load", async () => {
    const author = await makeUser("clerk_author", "author");
    const viewer = await makeUser("clerk_viewer", "viewer");
    const questionId = await askQuestion(author, ["react"]);

    await viewQuestion({ questionId, userId: String(viewer._id) });
    await viewQuestion({ questionId, userId: String(viewer._id) });
    await viewQuestion({ questionId, userId: String(viewer._id) });

    expect((await Question.findById(questionId))?.views).toBe(1);
    expect(
      await Interaction.countDocuments({ action: "view" }),
    ).toBe(1);
  });

  it("recommends questions sharing the user's interacted tags", async () => {
    const author = await makeUser("clerk_author", "author");
    const other = await makeUser("clerk_other", "other");
    const q1 = await askQuestion(author, ["react"]);
    await askQuestion(author, ["mongodb"]);
    await askQuestion(other, ["react"]);

    mocks.auth.mockResolvedValue(other);
    await viewQuestion({ questionId: q1, userId: String(other._id) });

    const { questions } = await getRecommentedQuestions({
      userId: "clerk_other",
    });

    const ids = questions.map((q) => String(q._id));
    expect(ids).toContain(String(q1));
    expect(ids).not.toContain(
      String((await Question.findOne({ tags: { $size: 0 } }))?._id ?? ""),
    );
    // The user's own react question is excluded.
    expect(
      questions.every((q) => String(q.author) !== String(other._id)),
    ).toBe(true);
  });
});

describe("collections", () => {
  it("saves and then unsaves a question", async () => {
    const author = await makeUser("clerk_author", "author");
    const saver = await makeUser("clerk_saver", "saver");
    const questionId = await askQuestion(author, ["react"]);

    mocks.auth.mockResolvedValue(saver);
    await toggleSaveQuestion({ questionId, path: "/" });
    expect(
      (await User.findById(saver._id))?.saved.map(String),
    ).toContain(questionId);

    await toggleSaveQuestion({ questionId, path: "/" });
    expect((await User.findById(saver._id))?.saved).toHaveLength(0);
  });
});

describe("answer votes", () => {
  it("downvoting an answer charges the voter and the author", async () => {
    const author = await makeUser("clerk_author", "author");
    const voter = await makeUser("clerk_voter", "voter");
    const questionId = await askQuestion(author, ["react"]);
    mocks.auth.mockResolvedValue(author);
    await createAnswer({
      content: "y".repeat(120),
      question: questionId,
      path: "/",
    });
    const answer = await Answer.findOne({ question: questionId });

    mocks.auth.mockResolvedValue(voter);
    await downvoteAnswer({
      answerId: String(answer?._id),
      hasupVoted: false,
      hasdownVoted: false,
      path: "/",
    });

    expect((await User.findById(voter._id))?.reputation).toBe(-2);
    expect((await User.findById(author._id))?.reputation).toBe(5);
  });
});
