import {
  Show,
  //  Show, SignInButton,
  UserButton,
} from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import React, { Suspense } from "react";
import Theme from "./Theme";
import MobileNav from "./MobileNav";
import GlobalSearch from "../search/GlobalSearch";

const Navbar = () => {
  return (
    <nav className="fixed z-50 flex-between w-full gap-5 background-light900_dark200 p-6 shadow-light-300 sm:px-12 dark:shadow-none">
      <Link href={"/"} className="flex items-center gap-1">
        <Image
          src={"/assets/images/site-logo.svg"}
          width={23}
          height={23}
          alt="DevFlow"
        />
        <p className="font-spaceGrotesk h2-bold text-dark-100 max-sm:hidden dark:text-light-900">
          Dev <span className="text-primary-500">Overflow</span>
        </p>
      </Link>
      {/* GlobalSearch reads useSearchParams(), which Next requires
          inside a Suspense boundary during prerender. Clerk 7's auth()
          no longer forces every (root) page dynamic the way v6 did, so
          statically-prerendered pages (e.g. /admin/ai) hit this without
          the boundary — the P4 base on Clerk 6 built only because every
          page happened to be dynamic. No visual change: the fallback
          renders nothing while the search input hydrates. */}
      <Suspense>
        <GlobalSearch />
      </Suspense>
      <div className="flex-between gap-5 ">
        <Theme />
        {/* <Show when="signed-out">
          <SignInButton fallbackRedirectUrl={"/"} />
        </Show> */}
        <Show when="signed-in">
          <UserButton
            appearance={{
              elements: {
                avatarBox: "h-8 w-8",
              },
              variables: {
                colorPrimary: "#ff7000",
              },
            }}
          />
        </Show>

        <MobileNav />
      </div>
    </nav>
  );
};

export default Navbar;
