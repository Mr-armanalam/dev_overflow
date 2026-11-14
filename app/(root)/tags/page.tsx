import Filter from "@/components/shared/Filter";
import NoResult from "@/components/shared/NoResult";
import Pagination from "@/components/shared/Pagination";
import LocalSearchbar from "@/components/shared/search/LocalSearchbar";
import { TagFilters } from "@/constants/filters";
import { getAllTags } from "@/lib/actions/tag.action";
// import { SearchParamsProps } from "@/types";
import Link from "next/link";
import React from "react";

type SearchParams = Promise<{ [key: string]: string | undefined }>

// const Page = async ({ searchParams }: SearchParamsProps) => {
const Page = async (prop:{ searchParams : SearchParams}) => {
  const searchparams = await prop.searchParams;
  const result = await getAllTags({
    searchQuery: searchparams.q,
    filter: searchparams.filter,
    page: searchparams.page ? +searchparams.page : 1,
  });

  return (
    <>
      <h1 className="h1-bold text-dark100_light900">All Tags</h1>

      <div className="mt-11 flex justify-between gap-5 max-sm:flex-col sm:items-center">
        <LocalSearchbar
          route="/tags"
          iconPosition="left"
          imgSrc="/assets/icons/search.svg"
          placeholder="Search for tags "
          otherClasses="flex-1"
        />

        <Filter
          filters={TagFilters}
          otherClasses="min-h-[56px] sm:min-w-[170px]"
        />
      </div>

      <section className="mt-12 flex flex-wrap gap-4">
        {result.tags.length > 0 ? (
          result.tags.map((tag) => (
            <Link
              href={`/tags/${tag._id}`}
              key={tag._id}
              className="shadow-light100_darknone "
            >
              <article
                className="flex w-full flex-col rounded-2xl border light-border background-light900_dark200
              px-8 py-10 sm:w-65 "
              >
                <div className="w-fit rounded-sm background-light800_dark400 px-5 py-1.5 ">
                  <p className="paragraph-semibold text-dark300_light900">
                    {tag.name}
                  </p>
                </div>

                <p className="mt-3.5 small-medium text-dark400_light500">
                  <span className="mr-2.5 primary-text-gradient body-semibold">
                    {tag.questions.length}+
                  </span>{" "}
                  Questions
                </p>
              </article>
            </Link>
          ))
        ) : (
          <NoResult
            title="No Tags Found"
            description="It looks like there are no tags found."
            link="/ask-queston"
            linkTitle="Ask a question"
          />
        )}
      </section>
      <div className="mt-10">
        <Pagination
          pageNumber={searchparams?.page ? +searchparams.page : 1}
          isNext={result.isNext}
        />
      </div>
    </>
  );
};

export default Page;
