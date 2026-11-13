import Question from '@/components/components/Question'
import { getQuestionsById } from '@/lib/actions/question.action';
// import { ParamsProps } from '@/types';
import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import React from 'react'

type Params = Promise<{ id: string }>

const Page = async (prop:{params: Params}) => {
  const paramsId = await prop.params;

  const { userId} = await auth();

  if(!userId) redirect('/sign-in');

  const result = await getQuestionsById({ questionId: paramsId.id}); // params.id

  if(!result) notFound();

  // Only the author may edit — previously any signed-in user could load
  // this page (and editQuestion had no ownership check either).
  if (result.author?.clerkId !== userId) {
    redirect(`/question/${paramsId.id}`);
  }

  return (
    <>
      <h1 className='h1-bold text-dark100_light900'>Edit Question</h1>

      <div className="mt-9">
        <Question
          type="Edit"
          questionDetails={JSON.stringify(result)}
        />
      </div>
    </>
  )
}

export default Page
