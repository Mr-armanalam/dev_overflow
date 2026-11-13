import Link from "next/link";
import React from "react";
import Metric from "../Metric";
import { formatNumber, getTimestamp } from "@/lib/utils";
import { Show } from "@clerk/nextjs";
import EditDeleteAction from "../shared/EditDeleteAction";

export interface QcProps {
  _id: string;
  clerkId?: string | null;
  author: {
    clerkId: string;
    name: string;
    picture: string;
  };
  upvotes: number;
  question: {
    _id: string;
    title: string;
  };
  createdAt: Date;
}

const AnswerCard = ({
  _id,
  clerkId,
  author,
  upvotes,
  question,
  createdAt,
}: QcProps) => {
  const showActionButton = clerkId && clerkId === author.clerkId;

  return (
    <div className="card-wrapper rounded-[10px] px-11 py-9 ">
      <Link
        href={`/question/${question._id}`}
        className="flex flex-col-reverse items-start justify-between gap-5 sm:flex-row"
      >
        <div>
          <span className="subtle-regular text-dark400_light700 line-clamp-1 flex sm:hidden ">
            {getTimestamp(createdAt)}
          </span>
          <h3 className="sm:h3-semibold base-semibold text-dark200_light900 line-clamp-1 flex-1">
            {question.title}
          </h3>
        </div>

        <Show when="signed-in">
          {showActionButton && (
            <EditDeleteAction type="Answer" itemId={JSON.stringify(_id)} />
          )}
        </Show>
      </Link>

      <div className="flex-between mt-6 w-full flex-wrap gap-3">
        <Metric
          imgUrl={author.picture}
          alt="User avatar"
          value={author.name}
          title={` - asked ${getTimestamp(createdAt)}`}
          href={`/profile/${author.clerkId}`}
          isAuthor
          textStyles="body-medium text-dark400_light700"
        />

        <div className="flex-center gap-3">
          <Metric
            imgUrl="/assets/icons/like.svg"
            alt="like icon"
            value={formatNumber(upvotes)}
            title="Votes"
            textStyles="small-medium text-dark400_light800"
          />
        </div>
      </div>
    </div>
  );
};

export default AnswerCard;
