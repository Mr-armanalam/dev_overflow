import { getUserAnswers } from '@/lib/actions/user.action';
import { SearchParamsProps } from '@/types'
import AnswerCard from '../cards/AnswerCard';
import Pagination from './Pagination';

interface Props extends SearchParamsProps {
  userId: string;
  clerkId?: string | null;
}

const AnswersTab = async ({ searchParams, userId, clerkId }: Props) => {
    const searchparams = await searchParams;

    const result = await getUserAnswers({ userId, page: searchparams.page ? +searchparams.page : 1,});

  return (
    <>
        {result.answers.map((item) =>(
            <AnswerCard 
                key={item._id}
                clerkId={clerkId}
                _id={item._id}
                question={item.question}
                author={item.author}
                createdAt={item.createdAt}
                upvotes={item.upvotes.length}
            />
        ))}

      <div className="mt-10">
        <Pagination 
          pageNumber={searchparams?.page ? +searchparams.page: 1}
          isNext={result.isNext}
        />
      </div>
    </>
  )
}

export default AnswersTab