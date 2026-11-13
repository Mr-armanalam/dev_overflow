/* eslint-disable spaced-comment */
'use client'
import { toast } from '@/hooks/use-toast';
import { downvoteAnswer, upvoteAnswer } from '@/lib/actions/answer.action';
import { downvoteQuestion, upvoteQuestion } from '@/lib/actions/question.action';
import { toggleSaveQuestion } from '@/lib/actions/user.action';
import { formatNumber } from '@/lib/utils';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import React from 'react'


 interface Props {
    type: string;
    itemId: string;
    // Optional: only used for the client-side "please log in" prompt.
    // The server actions derive the acting user from the Clerk session,
    // never from this prop.
    userId?: string;
    upvotes: number;
    hasupVoted: boolean;
    downvotes: number;
    hasdownVoted: boolean;
    hasSaved?: boolean;
 }

const Votes = ({
    type,
    itemId,
    userId,
    upvotes,
    hasupVoted,
    downvotes,
    hasdownVoted,
    hasSaved
}: Props) => {

    const pathname = usePathname();

    const handleSave = async () => {
        if(!userId) {
         return toast({
            title: 'Please log in',
            description: 'You must be logged in to perform this action'
        });;
        }

        await toggleSaveQuestion({
            questionId: JSON.parse(itemId),
            path: pathname
        })
        return toast({
            title: `Question ${!hasSaved ? 'Saved in' : 'Removed from'} your collection`,
            variant: !hasSaved ? 'default' : 'destructive'
        })
    }

    const handleVote = async (action: string) => {
        if(!userId) {
         return toast({
            title: 'Please log in',
            description: 'You must be logged in to perform this action'
        });;
        }

        if(action === 'upvote') {
            if(type === 'Question') {
                await upvoteQuestion({
                    questionId: JSON.parse(itemId),
                    hasupVoted,
                    hasdownVoted,
                    path: pathname
                })
            }else if(type === 'Answer'){
                await upvoteAnswer({
                    answerId: JSON.parse(itemId),
                    hasupVoted,
                    hasdownVoted,
                    path: pathname
                })
            }


            ///////////// show  a toast ////////////
            return toast({
                title: `Upvotes ${!hasupVoted ? 'Successfully' : 'Removed'}`,
                variant: !hasupVoted ? 'default' : 'destructive'
            })
        }

        if(action === 'downvote') {
            if(type === 'Question') {
                await downvoteQuestion({
                    questionId: JSON.parse(itemId),
                    hasupVoted,
                    hasdownVoted,
                    path: pathname
                })
            }else if(type === 'Answer'){
                await downvoteAnswer({
                    answerId: JSON.parse(itemId),
                    hasupVoted,
                    hasdownVoted,
                    path: pathname
                })
            }


            ///////////// show  a toast ////////////
            return toast({
                title: `DownVotes ${!hasdownVoted ? 'Successfully' : 'Removed'}`,
                variant: !hasdownVoted ? 'default' : 'destructive'
            })
        }
    } 
    
    // NOTE: view counting used to live here — it ran once per Votes
    // instance (once per answer too), inflating the count N+1 per load.
    // Views are now counted exactly once per question-page load, on the
    // server, in app/(root)/question/[id]/page.tsx via viewQuestion.

  return (
    <div className='flex gap-5'>
        <div className="flex-center gap-2.5">
            <div className="flex-center gap-1.5">
                <Image 
                    src={hasupVoted ? '/assets/icons/upvoted.svg': '/assets/icons/upvote.svg'}
                    width={18}
                    height={18}
                    alt='upvote'
                    className='cursor-pointer'
                    onClick={()=> handleVote('upvote')}
                />

                <div className='flex-center background-light700_dark400 min-w-[18px] rounded-sm p-1'>
                    <p className='subtle-medium text-dark400_ligt900'>
                        {formatNumber(upvotes)}
                    </p>
                </div>
            </div>
            <div className="flex-center gap-1.5">
                <Image 
                    src={hasdownVoted ? '/assets/icons/downvoted.svg': '/assets/icons/downvote.svg'}
                    width={18}
                    height={18}
                    alt='downvote'
                    className='cursor-pointer'
                    onClick={()=> handleVote('downvote')}
                />

                <div className='flex-center background-light700_dark400 min-w-[18px] rounded-sm p-1'>
                    <p className='subtle-medium text-dark400_ligt900'>
                        {formatNumber(downvotes)}
                    </p>
                </div>
            </div>
            {type === 'Question' && (<Image 
                src={hasSaved ? '/assets/icons/star-filled.svg': '/assets/icons/star-red.svg'}
                width={18}
                height={18}
                alt='save'
                className='cursor-pointer'
                onClick={handleSave}
            />)}

        </div>
    </div>
  )
}

export default Votes