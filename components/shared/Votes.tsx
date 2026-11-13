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
    // Mongo _id of the question/answer author (JSON.stringify'd, like
    // userId) — lets the client disable voting on your own content
    // instead of calling the server and surfacing an error.
    authorId?: string;
    upvotes: number;
    hasupVoted: boolean;
    downvotes: number;
    hasdownVoted: boolean;
    hasSaved?: boolean;
 }

// The id props arrive as JSON.stringify'd values (a quoted string).
// Unwrap them so "own content" can be compared by value.
const parseId = (value?: string): string | undefined => {
    if (!value) return undefined;
    try {
        return String(JSON.parse(value));
    } catch {
        return value;
    }
};

const Votes = ({
    type,
    itemId,
    userId,
    authorId,
    upvotes,
    hasupVoted,
    downvotes,
    hasdownVoted,
    hasSaved
}: Props) => {

    const pathname = usePathname();

    const isOwn = Boolean(userId && authorId && parseId(userId) === parseId(authorId));
    const ownLabel = `You can't vote on your own ${type === 'Question' ? 'question' : 'answer'}`;

    const handleSave = async () => {
        if(!userId) {
         return toast({
            title: 'Please log in',
            description: 'You must be logged in to perform this action'
        });;
        }

        try {
            await toggleSaveQuestion({
                questionId: JSON.parse(itemId),
                path: pathname
            })
            return toast({
                title: `Question ${!hasSaved ? 'Saved in' : 'Removed from'} your collection`,
                variant: !hasSaved ? 'default' : 'destructive'
            })
        } catch (error) {
            return toast({
                title: 'Something went wrong',
                description: error instanceof Error ? error.message : 'Please try again.',
                variant: 'destructive'
            })
        }
    }

    const handleVote = async (action: string) => {
        if(!userId) {
         return toast({
            title: 'Please log in',
            description: 'You must be logged in to perform this action'
        });;
        }

        // Never call the server for your own content: the vote actions
        // reject self-votes, and an uncaught server-action error shows
        // as a full-screen Next.js runtime-error overlay.
        if (isOwn) {
            return toast({
                title: ownLabel,
                variant: 'destructive'
            });
        }

        try {
            if(action === 'upvote') {
                let result;
                if(type === 'Question') {
                    result = await upvoteQuestion({
                        questionId: JSON.parse(itemId),
                        hasupVoted,
                        hasdownVoted,
                        path: pathname
                    })
                }else if(type === 'Answer'){
                    result = await upvoteAnswer({
                        answerId: JSON.parse(itemId),
                        hasupVoted,
                        hasdownVoted,
                        path: pathname
                    })
                }

                if (result && result.success === false) {
                    return toast({
                        title: result.error ?? 'Something went wrong',
                        variant: 'destructive'
                    })
                }

                ///////////// show  a toast ////////////
                return toast({
                    title: `Upvotes ${!hasupVoted ? 'Successfully' : 'Removed'}`,
                    variant: !hasupVoted ? 'default' : 'destructive'
                })
            }

            if(action === 'downvote') {
                let result;
                if(type === 'Question') {
                    result = await downvoteQuestion({
                        questionId: JSON.parse(itemId),
                        hasupVoted,
                        hasdownVoted,
                        path: pathname
                    })
                }else if(type === 'Answer'){
                    result = await downvoteAnswer({
                        answerId: JSON.parse(itemId),
                        hasupVoted,
                        hasdownVoted,
                        path: pathname
                    })
                }

                if (result && result.success === false) {
                    return toast({
                        title: result.error ?? 'Something went wrong',
                        variant: 'destructive'
                    })
                }

                ///////////// show  a toast ////////////
                return toast({
                    title: `DownVotes ${!hasdownVoted ? 'Successfully' : 'Removed'}`,
                    variant: !hasdownVoted ? 'default' : 'destructive'
                })
            }
        } catch (error) {
            return toast({
                title: 'Something went wrong',
                description: error instanceof Error ? error.message : 'Please try again.',
                variant: 'destructive'
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
                    title={isOwn ? ownLabel : 'Upvote'}
                    className={isOwn ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
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
                    title={isOwn ? ownLabel : 'Downvote'}
                    className={isOwn ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
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
