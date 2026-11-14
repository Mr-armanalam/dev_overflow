import { Skeleton } from '@/components/ui/skeleton'
import React from 'react'

const Loading = () => {
  return (
    <section>
            <Skeleton className = 'h-12 w-52' />
            <Skeleton className = 'mt-11 mb-12 h-14 w-full' />

        <div className="flex flex-wrap gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((item) => (
                <Skeleton key={item} className='h-48 w-full rounded-xl '/>
            ))}
        </div>
    </section>
  )
}

export default Loading