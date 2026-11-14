 
import { getTopInteractedTags } from "@/lib/actions/tag.action";
import Image from "next/image";
import Link from "next/link";
import React from "react";
import { Badge } from "../ui/badge";
import RenderTag from "../shared/RenderTag";

interface Props {
  user: {
    _id: string;
    clerkId: string;
    picture: string;
    name: string;
    username: string;
  };
}

const UserCard = async ({ user }: Props) => {
  const interactedTags = await getTopInteractedTags({ userId: user._id });
  return (
    // <Link href={`/profile/${user.clerkId}`} className='shadow-light100_darknone w-full max-xs:min-w-full xs:w-[260px]'>
    <section className="w-full shadow-light100_darknone max-xs:min-w-full xs:w-65">
      <article className="flex w-full flex-col items-center justify-center rounded-2xl border light-border background-light900_dark200 p-8 ">
        <Link href={`/profile/${user.clerkId}`}>
          <Image
            src={user.picture}
            alt="user profile picture"
            width={100}
            height={100}
            className="mx-auto rounded-full"
          />

          <div className="mt-4 text-center">
            <h3 className="line-clamp-1 h3-bold text-dark200_light900 ">
              {user.name}
            </h3>
            <p className="bodey-regular mt-2 text-dark500_light500">
              {user.username}
            </p>
          </div>
        </Link>

        <div className="mt-5">
          {interactedTags.length > 0 ? (
            <div className="flex items-center gap-2">
              {interactedTags.map((tag) => (
                <RenderTag key={tag._id} _id={tag._id} name={tag.name} />
              ))}
            </div>
          ) : (
            <Badge>No tags yet</Badge>
          )}
        </div>
      </article>
    </section> ///////// link tag ///////////
  );
};

export default UserCard;
