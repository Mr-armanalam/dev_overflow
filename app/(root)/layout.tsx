import LeftSidebar from '@/components/LeftSidebar'
import RightSidebar from '@/components/RightSidebar'
import Navbar from '@/components/shared/navbar/Navbar'
import { Toaster } from '@/components/ui/toaster'
import React from 'react'

const Layout = ({children}:{children:React.ReactNode}) => {
  return (
    <main 
    className='relative background-light850_dark100'
    >
        <Navbar />
        <div className="flex">
            <LeftSidebar /> 
            <section className='flex min-h-screen flex-1 flex-col px-6 pt-36 max-md:pb-14 sm:px-14'>
                <div className="mx-auto w-full">
                    {children}
                </div>
            </section>
            <RightSidebar/>
        </div>

        <Toaster />
    </main>
  )
}

export default Layout