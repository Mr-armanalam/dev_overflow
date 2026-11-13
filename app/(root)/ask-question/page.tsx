import Question from '@/components/components/Question'
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import React from 'react'


const Page = async () => {
  const { userId } = await auth();

  if (!userId) redirect('/sign-in');

  // NOTE: the author is resolved from the Clerk session inside
  // createQuestion — the page no longer needs to load the Mongo user.
  return (
    <div>
      <h1 className="h1-bold text-dark100_light900">Ask a question</h1>
      <div className='mt-9'>
        <Question />
      </div>
    </div>
  )
}

export default Page
