import { Button } from "@/components/ui/button";
import { getUserInfo } from "@/lib/actions/user.action";
// import { URLProps } from "@/types";
import { Show } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Image from "next/image";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import React from "react";
import { getMonthYear } from "@/lib/utils";
import ProfileLink from "@/components/shared/ProfileLink";
import Stats from "@/components/shared/Stats";
import QuestionTab from "@/components/shared/QuestionTab";
import AnswersTab from "@/components/shared/AnswersTab";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile | Dev Overflow",
  openGraph: {
    type: "website",
    url: "https://stack-overflow-gray.vercel.app/",
    images: "/profile_page.png",
  },
}

type Params = Promise<{ id: string }>
type SearchParams = Promise<{ [key: string]: string | undefined }>

// const Page = async ({ params, searchParams }: URLProps) => {
const Page = async (props: { params: Params, searchParams: SearchParams}) => {

  const { userId: clerkId } = await auth();
  const paramsId = await props.params;
  const searchparams = await props.searchParams

  const userInfo = await getUserInfo({ userId: paramsId.id });    // params.id

  return (
    <>
      <div className="flex flex-col-reverse items-start justify-between sm:flex-row">
        <div className="flex flex-col items-start gap-4 lg:flex-row">
          <Image
            src={userInfo?.user.picture}
            alt="profile picture"
            width={140}
            height={140}
            className="rounded-full object-cover"
          />

          <div className="mt-3">
            <h2 className="h2-bold text-dark100_light900">{userInfo.user.name}</h2>
            <p className="paragraph-regular text-dark200_light800">@{userInfo.user.username}</p>

            <div className="mt-5 flex flex-wrap items-center justify-start gap-5">
                {userInfo.user.portfolioWebsite && (
                    <ProfileLink
                        imgUrl='/assets/icons/link.svg'
                        href={userInfo.user.portfolioWebsite}
                        title="Portfolio"
                    />
                )}

                {userInfo.user.location && (
                    <ProfileLink
                        imgUrl='/assets/icons/location.svg'
                        title={userInfo.user.location}
                    />
                )}

                <ProfileLink
                    imgUrl='/assets/icons/calendar.svg'
                    title={getMonthYear(userInfo.user.joinedAt)}
                />              
            </div>

            {userInfo.user.bio && (
                <p className="paragraph-regular text-dark400_light800 mt-8">
                    {userInfo.user.bio}
                </p>
            )}
          </div>
        </div>

        <div className="flex justify-end max-sm:mb-5 max-sm:w-full sm:mt-3">
          <Show when="signed-in">
            {clerkId === userInfo.user.clerkId && (
              <Link href={"/profile/edit"}>
                <Button
                  className="paragraph-medium btn-secondary text-dark300_light900
                            min-h-[46ps] min-w-[175px] px-4 py-3"
                >
                  Edit Profile
                </Button>
              </Link>
            )}
          </Show>
        </div>
      </div>

      <Stats
        reputation = {userInfo.reputation}
        totalQuestions = {userInfo.totalQuestion}
        totalAnswers = {userInfo.totalAnswer}
        badges = {userInfo.badgeCounts}
      />

      <div className="mt-10 flex gap-10">
        <Tabs defaultValue="top-posts" className="flex-1">
          <TabsList className="background-light800_dark400 min-h-[42px] p-1">
            <TabsTrigger value="top-posts" className="tab">Top Posts</TabsTrigger>
            <TabsTrigger value="answers" className="tab">Answers</TabsTrigger>
          </TabsList>
          <TabsContent value="top-posts" className="mt-5 flex w-full flex-col gap-6">
            <QuestionTab 
              searchParams={searchparams}
              userId={userInfo.user._id}
              clerkId={clerkId}
            />
          </TabsContent>
          <TabsContent value="answers" className="flex w-full flex-col gap-6">
            <AnswersTab
              searchParams={searchparams}
              userId={userInfo.user._id}
              clerkId={clerkId}
            />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
};

export default Page;
