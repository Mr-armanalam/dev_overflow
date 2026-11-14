import QuestionCard, { QcProps } from '@/components/cards/QuestionCard'
import NoResult from '@/components/shared/NoResult'
import Pagination from '@/components/shared/Pagination'
import LocalSearchbar from '@/components/shared/search/LocalSearchbar'
import { getQuesionsByTagId } from '@/lib/actions/tag.action'
import { auth } from '@clerk/nextjs/server'
// import { URLProps } from '@/types'
import React from 'react'

type Params = Promise<{ id: string }>
type SearchParams = Promise<{ [key: string]: string | undefined }>

// const Page = async ({params, searchParams}: URLProps) => {
const Page = async (props: { params: Params, searchParams: SearchParams }) => {
  const searchparams = await props.searchParams;
  const paraams = await props.params
  const { userId } = await auth();

    const result = await getQuesionsByTagId({
        tagId: paraams.id,
        page: searchparams.page ? +searchparams.page : 1,
        searchQuery: searchparams.q
    }) 
    
  return (
    <>
        <h1 className="h1-bold text-dark100_light900">{result.tagTitle}</h1>

      <div className="mt-11 w-full">
        <LocalSearchbar
          route={`/tags/${paraams.id}`}
          iconPosition="left"
          imgSrc="/assets/icons/search.svg"
          placeholder="Search tag questions..."
          otherClasses="flex-1"
        />
      </div>

      <div className="mt-10 flex w-full flex-col gap-6">
        {result.questions.length > 0 ?
        result.questions.map((question:QcProps)=> (
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
        title="There&apos;s no tag question to show"
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
  )
}

export default Page