 
import Link from "next/link";
import React from "react";
import RenderTag from "../shared/RenderTag";
import Metric from "../Metric";
import { formatNumber, getTimestamp } from "@/lib/utils";
import { Show } from "@clerk/nextjs";
import EditDeleteAction from "../shared/EditDeleteAction";

export interface QcProps {
  _id: string;
  clerkId?: string | null;
  title: string;
  tags: {
    _id: string;
    name: string;
  }[];
  author: {
    _id: string;
    name: string;
    picture: string;
    clerkId: string;
  };
  upvotes: string[];
  views: number;
  answers: Array<object>;
  createdAt: Date;
}

const QuestionCard = ({
  _id,
  clerkId,
  title,
  tags,
  author,
  upvotes,
  views,
  answers,
  createdAt,
}: QcProps) => {

  const showActionButton = clerkId && clerkId === author.clerkId;

  return <div className="rounded-[10px] card-wrapper p-9 sm:px-11 ">
    <div className="flex flex-col-reverse items-start justify-between gap-5 sm:flex-row">
        <div>
            <span className="line-clamp-1 flex subtle-regular text-dark400_light700 sm:hidden ">
                {getTimestamp(createdAt)}
            </span>
            <Link href={`/question/${_id}`}>
                <h3 className="line-clamp-1 flex-1 base-semibold text-dark200_light900 sm:h3-semibold">{title}</h3>
            </Link>
        </div>
        
        <Show when="signed-in">
          {showActionButton && (
            <EditDeleteAction type="Question" itemId={JSON.stringify(_id)} />
          )}
        </Show>

    </div>

    <div className="mt-3.5 flex flex-wrap gap-2">
        {tags.map((tag, index)=> (
            <RenderTag key={tag._id+index} _id={tag._id} name={tag.name}  /> //////// key problem /////////////
        ))}
    </div>

    <div className="mt-6 flex-between w-full flex-wrap gap-3">
        <Metric 
        imgUrl={author.picture}
        alt="User"
        value={author.name}
        title={` - asked ${getTimestamp(createdAt)}`}
        href={`/profile/${author.clerkId}`}
        isAuthor
        textStyles= "body-medium text-dark400_light700"
        />
        <div className="flex items-center gap-3 max-sm:flex-wrap max-sm:justify-start">
          <Metric 
          imgUrl="/assets/icons/like.svg"
          alt="Upvotes"
          value={formatNumber(upvotes?.length)}
          title="Votes"
          textStyles= "small-medium text-dark400_light800"
          />
          <Metric 
          imgUrl="/assets/icons/message.svg"
          alt="Upvotes"
          value={formatNumber(answers?.length)}
          title="Answers"
          textStyles= "small-medium text-dark400_light800"
          />
          <Metric 
          imgUrl="/assets/icons/eye.svg"
          alt="eye"
          value={formatNumber(views)}
          title="Views"
          textStyles= "small-medium text-dark400_light800"
          />
        </div>
    </div>

    </div>;
};

export default QuestionCard;
