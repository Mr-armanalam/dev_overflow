import UserCard from "@/components/cards/UserCard";
import Filter from "@/components/shared/Filter";
import Pagination from "@/components/shared/Pagination";
import LocalSearchbar from "@/components/shared/search/LocalSearchbar";
import { UserFilters } from "@/constants/filters";
import { getAllUsers } from "@/lib/actions/user.action";
// import { SearchParamsProps } from "@/types";
import { Metadata } from "next";
import Link from "next/link";
import React from "react";

export const metadata: Metadata = {
  title: "Community | Dev Overflow",
  openGraph: {
    type: "website",
    url: "https://stack-overflow-gray.vercel.app/",
    images: "/community_page.png",
  },
}

type SearchParams = Promise<{ [key: string]: string | undefined }>
const Page = async (prop: {searchParams : SearchParams} ) => {
  const searchparams = await prop.searchParams;
  const result = await getAllUsers({
    searchQuery: searchparams.q,
    filter: searchparams.filter,
    page: searchparams.page ? +searchparams.page : 1,
  });


  return (
    <>
      <h1 className="h1-bold text-dark100_light900">All Users</h1>

      <div className="mt-11 flex justify-between gap-5 max-sm:flex-col sm:items-center">
        <LocalSearchbar
          route="/community"
          iconPosition="left"
          imgSrc="/assets/icons/search.svg"
          placeholder="Search for amazing minds"
          otherClasses="flex-1"
        />

        <Filter
          filters={UserFilters}
          otherClasses="min-h-[56px] sm:min-w-[170px]"
        />
      </div>

      <section className="mt-12 flex flex-wrap gap-4">
        {result.users.length > 0 ? (
          result.users.map((user) => <UserCard key={user._id} user={user} />)
        ) : (
          <div className="mx-auto max-w-4xl text-center paragraph-regular text-dark200_light800 ">
            <p>No users yet</p>
            <Link
              href={"/sign-up"}
              className="mt-2 font-bold text-accent-blue  "
            >
              Join to be first!
            </Link>
          </div>
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
