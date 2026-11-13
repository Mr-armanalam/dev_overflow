/* eslint-disable spaced-comment */
import React from "react";
import Filter from "./Filter";
import { AnswerFilters } from "@/constants/filters";
import { getAnswers } from "@/lib/actions/answer.action";
import Link from "next/link";
import Image from "next/image";
import { getTimestamp } from "@/lib/utils";
import ParseHTML from "./ParseHTML";
import Votes from "./Votes";
import Pagination from "./Pagination";

interface Props {
  questionId: string;
  // Undefined for logged-out visitors; Votes prompts them to log in.
  userId?: string;
  totalAnswers: number;
  page?: string | string[];
  filter?: string | string[];
}

const AllAnswers = async ({
  questionId,
  userId,
  totalAnswers,
  page,
  filter,
}: Props) => {
  const answer = await getAnswers({
    questionId,
    page: page ? +page : 1,
    sortBy: filter,
  });

  return (
    <div className="mt-11 ">
      <div className="flex items-center justify-between">
        <h3>{totalAnswers} Answers</h3>

        <Filter filters={AnswerFilters} />
      </div>

      <div>
        {answer.answers.map((answer) => (
          <article key={answer._id} className="light-border border-b py-10">
              {/* SPAN ID */}
              <div className="mb-8 flex flex-col-reverse justify-between gap-5 sm:flex-row sm:items-center sm:gap-2">
                <Link
                  href={`/profile/${answer.author.clerkId}`}
                  className="flex flex-1 items-start gap-1 sm:items-center"
                >
                  <Image
                    src={answer.author.picture}
                    width={18}
                    height={18}
                    alt="profile"
                    className="rounded-full object-cover max-sm:mt-0.5"
                  />

                  <div className="flex flex-col sm:flex-row sm:items-center ">
                    <p className="body-semibold text-dark300_light700">
                      {answer.author.name}
                    </p>

                    <p className="small-regular text-light400_light500 ml-0.5 mt-0.5 line-clamp-1">
                      answered {getTimestamp(answer.createdAt)}
                    </p>
                  </div>
                </Link>
                <div className="flex justify-end">
                  <Votes
                    type="Answer"
                    itemId={JSON.stringify(answer._id)}
                    userId={userId ? JSON.stringify(userId) : undefined} //////////// for findig current user ///////////////////
                    upvotes={answer.upvotes.length}
                    hasupVoted={answer.upvotes.includes(userId)}
                    downvotes={answer.downvotes.length}
                    hasdownVoted={answer.downvotes.includes(userId)}
                  />
                </div>
              </div>
            <ParseHTML data={answer.content} />
          </article>
        ))}
      </div>
      <div className="mt-10 w-full">
        <Pagination pageNumber={page ? +page : 1} isNext={answer.isNext} />
      </div>
    </div>
  );
};

export default AllAnswers;
