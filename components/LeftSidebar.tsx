/* eslint-disable @typescript-eslint/no-unused-expressions */
'use client'
import { sidebarLinks } from "@/constants";
import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { SignedOut, useAuth } from "@clerk/nextjs";
import { Button } from "./ui/button";
import { useCan } from "@/lib/auth/use-permissions";

const LeftSidebar = () => {
  const {userId} = useAuth();
  // console.log(userId);

  // Admin UI gating only — the pages themselves enforce the role
  // server-side (lib/auth/server-permissions.ts); hiding a link here
  // never grants access on its own.
  const canViewAdminAi = useCan("ai:admin:dashboard");
  const canReviewDuplicates = useCan("ai:duplicate:confirm");
  const links = [
    ...sidebarLinks,
    ...(canViewAdminAi
      ? [
          {
            imgURL: "/assets/icons/stars.svg",
            route: "/admin/ai",
            label: "AI Usage",
          },
        ]
      : []),
    ...(canReviewDuplicates
      ? [
          {
            imgURL: "/assets/icons/question.svg",
            route: "/admin/duplicates",
            label: "Duplicates",
          },
        ]
      : []),
  ];
  const pathname = usePathname();
  return (
    <section
      className="background-light900_dark200 light-border custom-scrollbar sticky left-0 top-0 flex h-screen flex-col
     justify-between overflow-y-auto border-r p-6 pt-36 shadow-light-300 dark:shadow-none max-sm:hidden lg:w-[266px]"
    >
      <div className="flex flex-1 flex-col gap-6">
        {links.map((item) => {
          const isActive =
            (pathname.includes(item.route) && item.route.length > 1) ||
            pathname === item.route;

           if(item.route === '/profile'){
            if(userId) {
              item.route = `${item.route}/${userId}`            
            } else null;
           } 

          return (
            <Link
              href={item.route}
              key={item.route}
              className={`${
                isActive
                  ? "primary-gradient rounded-lg text-light-900"
                  : "text-dark300_light900"
              } flex items-center justify-start gap-4 bg-transparent p-4
                `}
            >
              <Image
                src={item.imgURL}
                alt={item.label}
                width={20}
                height={20}
                className={`${isActive ? "" : "invert-colors"}`}
              />
              <p className={`${isActive ? "base-bold" : "base-medium"} max-lg:hidden`}>
                {item.label}
              </p>
            </Link>
          );
        })}
      </div>

      <SignedOut>
            <div className="flex flex-col gap-3">
                <Link href={"/sign-in"}>
                  <Button className="small-medium btn-secondary min-h-[41px] w-full rounded-lg px-4 py-3 shadow-none">
                    <Image 
                    src={"/assets/icons/account.svg"}
                    alt="login"
                    width={20}
                    height={20}
                    className="invert-colors lg:hidden"
                    />
                    <span className="primary-text-gradient max-lg:hidden">Log In</span>
                  </Button>
                </Link>
                <Link href={"/sign-up"}>
                  <Button className="small-medium light-border-2 btn-tertiary text-dark400_light900 min-h-[41px] w-full rounded-lg px-4 py-3 shadow-none">
                  <Image 
                    src={"/assets/icons/sign-up.svg"}
                    alt="sign up"
                    width={20}
                    height={20}
                    className="invert-colors lg:hidden"
                    />
                    <span className=" max-lg:hidden">Sign Up</span>
                  </Button>
                </Link>
            </div>
          </SignedOut>
    </section>
  );
};

export default LeftSidebar;
