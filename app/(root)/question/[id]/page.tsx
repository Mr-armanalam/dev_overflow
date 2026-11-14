/* eslint-disable @typescript-eslint/no-explicit-any */
 
import React from "react";
import Image from "next/image";
import Link from "next/link";
import Metric from "@/components/Metric";
import ParseHTML from "@/components/shared/ParseHTML";
import RenderTag from "@/components/shared/RenderTag";
import { getQuestionsById } from "@/lib/actions/question.action";
import { formatNumber, getTimestamp } from "@/lib/utils";
import Answer from "@/components/forms/Answer";
import { auth } from "@clerk/nextjs/server";
import { getUserById } from "@/lib/actions/user.action";
import { viewQuestion } from "@/lib/actions/interaction.action";
import AllAnswers from "@/components/shared/AllAnswers";
import Votes from "@/components/shared/Votes";
import { notFound } from "next/navigation";


type Params = Promise<{ id: string }>
type SearchParams = Promise<{ [key: string]: string | string[] }>

// const page = async ({
//   params,
//   searchParams,
// }: {
//   params: { id: string };
//   searchParams: { [key: string]: string | string[] };
// }) => {


const page = async (props: { params: Params, searchParams: SearchParams}) => {
  //////////////////   console.log(params);    ////////////////////////

  const { id } = await props.params;
  const searchparams = await props.searchParams;

  const { userId: clerkId } = await auth();

  // Logged-out visitors may view the question; mongoUser stays
  // undefined and every use below guards against it (previously this
  // dereferenced mongoUser._id and crashed the public page).
  let mongoUser;

  if (clerkId) {
    try {
      mongoUser = await getUserById({ userId: clerkId });
    } catch {
      // Clerk user not synced to MongoDB yet (webhook lag) — treat as
      // logged out for display purposes instead of crashing.
      mongoUser = undefined;
    }
  }

  const result = await getQuestionsById({ questionId: id });

  // Unknown id, or a question whose author no longer exists.
  if (!result || !result.author) {
    notFound();
  }

  // Count the view exactly once per page load, only for signed-in
  // users. viewQuestion dedups per user, so repeat loads and
  // re-renders do not inflate the count (previously every Votes
  // instance — one per answer — incremented it on mount).
  if (mongoUser) {
    await viewQuestion({
      questionId: id,
      userId: mongoUser._id.toString(),
    });
  }

  return (
    <>
      <div className="flex-start w-full flex-col">
        <div className="flex w-full flex-col-reverse justify-between gap-5 sm:flex-row sm:items-center sm:gap-2">
          <Link
            href={`/profile/${result?.author.clerkId}`}
            className="flex flex-row items-center justify-start gap-1"
          >
            <Image
              src={result.author.picture}
              className="rounded-full"
              width={22}
              height={22}
              alt="profile picture"
            />

            <p className="paragraph-semibold text-dark300_light700">
              {result.author.name}
            </p>
          </Link>

          <div className="flex justify-end">
            <Votes
              type="Question"
              itemId={JSON.stringify(result._id)}
              userId={mongoUser ? JSON.stringify(mongoUser._id) : undefined} //////////// for findig current user ///////////////////
              authorId={JSON.stringify(result.author._id)}
              upvotes={result.upvotes.length}
              hasupVoted={mongoUser ? result.upvotes.includes(mongoUser._id) : false}
              downvotes={result.downvotes.length}
              hasdownVoted={mongoUser ? result.downvotes.includes(mongoUser._id) : false}
              hasSaved={mongoUser?.saved.includes(result._id)}
            />
          </div>
        </div>
        <h2 className="mt-3.5 w-full text-left h2-semibold text-dark200_light900">
          {result.title}
        </h2>
      </div>
      <div className="mt-5 mb-8 flex flex-wrap gap-4">
        <Metric
          imgUrl="/assets/icons/like.svg"
          alt="clock icon"
          value={`asked ${getTimestamp(result.createdAt)}`}
          title="Asked"
          textStyles="small-medium text-dark400_light800"
        />
        <Metric
          imgUrl="/assets/icons/message.svg"
          alt="Upvotes"
          value={formatNumber(result.answers?.length)} ///////////  Edited  ////////////
          title="Answers"
          textStyles="small-medium text-dark400_light800"
        />
        <Metric
          imgUrl="/assets/icons/eye.svg"
          alt="eye"
          value={formatNumber(result.views)}
          title="Votes"
          textStyles="small-medium text-dark400_light800"
        />
      </div>

      <ParseHTML data={result.content} />

      <div className="mt-8 flex flex-wrap gap-2">
        {result.tags.map((tag: any) => (
          <RenderTag
            key={tag._id}
            _id={tag._id}
            name={tag.name}
            showCount={false}
          />
        ))}
      </div>

      <AllAnswers
        questionId={result._id}
        userId={mongoUser?._id}  ///////////////// Edited /////////////////
        totalAnswers={result.answers?.length}
        page={searchparams.page }
        filter={searchparams.filter}
        // page={props.searchParams?.page }
        // filter={props.searchParams?.filter}
      />

      {mongoUser ? (
        <Answer questionId={JSON.stringify(result._id)} />
      ) : (
        <p className="mt-10 paragraph-regular text-dark400_light800">
          <Link href="/sign-in" className="text-primary-500">
            Sign in
          </Link>{" "}
          to write an answer.
        </p>
      )}
    </>
  );
};

export default page;
