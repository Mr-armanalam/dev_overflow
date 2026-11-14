import QuestionCard from "@/components/cards/QuestionCard";
import HomeFilters from "@/components/home/HomeFilters";
import Filter from "@/components/shared/Filter";
import NoResult from "@/components/shared/NoResult";
import Pagination from "@/components/shared/Pagination";
import LocalSearchbar from "@/components/shared/search/LocalSearchbar";
import { Button } from "@/components/ui/button";
import { HomePageFilters } from "@/constants/filters";
import { getQuestions, getRecommentedQuestions } from "@/lib/actions/question.action";
// import { SearchParamsProps } from "@/types";
import Link from "next/link";
import React from "react";

import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";

export const metadata: Metadata = {
  title: "Home | Dev Overflow",
  openGraph: {
    type: "website",
    url: "https://stack-overflow-gray.vercel.app/",
    images: "/home_page.png",
  },
}

type SearchParams = Promise<{ [key: string]: string | undefined }>
// const Home = async ({ searchParams }: SearchParams ) => {
const Home = async (prop: {searchParams : SearchParams} ) => {
  const searchparams = await prop.searchParams;
  const { userId } = await auth();

  let result;

  if(searchparams?.filter === 'recommended') {
    if(userId) {
      result = await getRecommentedQuestions({
        userId,
        searchQuery: searchparams.q,
        page: searchparams.page ? +searchparams.page : 1,
      }); 
    } else {
      result = {
        questions: [],
        isNext: false
      }
    }
  } else {
    result = await getQuestions({
      searchQuery: searchparams.q,
      filter: searchparams.filter,
      page: searchparams.page ? +searchparams.page : 1,
    }); 
  }


  return (
    <>
      <div className="flex w-full flex-col-reverse justify-between gap-4 sm:flex-row sm:items-center">
        <h1 className="h1-bold text-dark100_light900">All Questions</h1>

        <Link href={"/ask-question"} className="flex justify-end max-sm:w-full">
          <Button className="min-h-[46px] px-4 py-3 text-light-900! primary-gradient">
            Ask a Question
          </Button>
        </Link>
      </div>

      <div className="mt-11 flex justify-between gap-5 max-sm:flex-col sm:items-center">
        <LocalSearchbar
          route="/"
          iconPosition="left"
          imgSrc="/assets/icons/search.svg"
          placeholder="Search for questions..."
          otherClasses="flex-1"
        />

        <Filter
          filters={HomePageFilters}
          otherClasses="min-h-[56px] sm:min-w-[170px]"
          containerClass="hidden max-md:flex "
        />
      </div>

      <HomeFilters />

      <div className="mt-10 flex w-full flex-col gap-6">
        {result.questions.length > 0 ?
        result.questions.map((question)=> (
          <QuestionCard
          key={question._id}
          _id={question._id}
          clerkId={userId}
          title={question.title}
          tags={question.tags}
          author={question.author}
          upvotes={question.upvotes}
          views={question.views}
          answers={question.answers}
          createdAt={question.createdAt}
          />
        )): 
        <NoResult 
        title="There&apos;s no question to show"
        description=" Be the first to break the silence! 🚀 Ask a Question and kickstart the
        discussion. our query could be the next big thing others learn from. Get
        involved! 💡"
        link="/ask-question"
        linkTitle="Ask a Question"
        />}
      </div>

      <div className="mt-10">
        <Pagination 
          pageNumber={searchparams?.page ? +searchparams.page: 1}
          isNext={result.isNext}
        />
      </div>
      
    </>
  );
};

export default Home;
