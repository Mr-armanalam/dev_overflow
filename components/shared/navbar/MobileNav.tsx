"use client";
import React from "react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import Image from "next/image";
import Link from "next/link";
import { Show } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { sidebarLinks } from "@/constants";
import { usePathname } from "next/navigation";

const NavContent = () => {
  const pathname = usePathname();
  return (
    <section className="flex size-full flex-col gap-6 pt-16">
      {sidebarLinks.map((item) => {
        const isActive =
          (pathname.includes(item.route) && item.route.length > 1) ||
          pathname === item.route;

        return (
          <SheetClose key={item.route} asChild className="w-full">
            <Link
              href={item.route}
              className={`${
                isActive
                  ? "rounded-lg text-light-900 primary-gradient"
                  : "text-dark300_light900"
              } flex items-center justify-start gap-4 bg-transparent p-4
                `}
            >
              <Image
                src={item.imgURL}
                alt={item.label}
                width={20}
                height={20}
                className={`${isActive? "" : "invert-colors"}`}
              />
              <p className={`${isActive ? 'base-bold' : 'base-medium'}`}>{item.label}</p>
            </Link>
          </SheetClose>
        );
      })}
    </section>
  );
};

const MobileNav = () => {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Image
          src={"/assets/icons/hamburger.svg"}
          width={36}
          height={36}
          alt="menu"
          className="invert-colors sm:hidden"
        />
      </SheetTrigger>
      <SheetContent
        side={"left"}
        className="border-none background-light900_dark200"
      >
        <SheetTitle>
          <Link href={"/"} className="flex items-center gap-1">
            <Image
              src={"/assets/images/site-logo.svg"}
              width={23}
              height={23}
              alt="DevFlow"
            />
            <p className="font-spaceGrotesk h2-bold text-dark100_light900 ">
              Dev <span className="text-primary-500">Overflow</span>
            </p>
          </Link>
        </SheetTitle>
        <div>
          <SheetClose className="w-full">
            <NavContent />
          </SheetClose>

          <Show when="signed-out">
            <div className="flex flex-col gap-3">
              <SheetClose asChild>
                <Link href={"/sign-in"}>
                  <Button className="min-h-[41px] w-full rounded-lg btn-secondary px-4 py-3 small-medium shadow-none">
                    <span className="primary-text-gradient">Log In</span>
                  </Button>
                </Link>
              </SheetClose>
              <SheetClose asChild>
                <Link href={"/sign-up"}>
                  <Button className="min-h-[41px] w-full rounded-lg light-border-2 btn-tertiary px-4 py-3 small-medium text-dark400_light900 shadow-none">
                    Sign Up
                  </Button>
                </Link>
              </SheetClose>
            </div>
          </Show>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default MobileNav;
