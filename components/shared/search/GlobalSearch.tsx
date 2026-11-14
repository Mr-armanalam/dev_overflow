/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import Image from "next/image";
import React, { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formUrlQuery, removeKeysFromQuery } from "@/lib/utils";
import GlobalResult from "./GlobalResult";

const GlobalSearch = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = searchParams.get("q");

  const [search, setSearch] = useState(query || "");
  const [isOpen, setIsOpen] = useState(false);
  const searchContainerRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (event: any) => {
        if (searchContainerRef.current && 
            // @ts-expect-error "at contains"
            !searchContainerRef.current.contains(event?.target)
        ) {
            setIsOpen(false);
            setSearch("");
        }
    }

    setIsOpen(false);

    document.addEventListener("click", handleOutsideClick);

    return () => {
        document.removeEventListener("click", handleOutsideClick);
    }
  },[pathname])

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      // Guard: Next has no same-URL bailout — pushing the URL we are
      // already on re-renders the page and re-fires this effect (the
      // fresh useSearchParams() object is a dependency), so only
      // navigate when the target actually differs.
      const currentUrl = window.location.pathname + window.location.search;
      if (search) {
        const newUrl = formUrlQuery({
          params: searchParams.toString(),
          key: "global",
          value: search,
        });

        if (newUrl !== currentUrl) router.push(newUrl, { scroll: false });
      } else {
        if (query) {
          const newUrl = removeKeysFromQuery({
            params: searchParams.toString(),
            keysToRemove: ["global", 'type'],
          });
          if (newUrl !== currentUrl) router.push(newUrl, { scroll: false });
        }
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [search, pathname, router, searchParams, query]);

  return (
    <div className="relative w-full max-w-150 max-lg:hidden" ref={searchContainerRef}>
      <div className="relative flex min-h-14 grow items-center gap-1 rounded-xl background-light800_darkgradient px-4">
        <Image
          src={"/assets/icons/search.svg"}
          alt="search"
          width={24}
          height={24}
          className="cursor-pointer"
        />
        <Input
          type="text"
          placeholder="Search globally"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);

            if(!isOpen) setIsOpen(true);
            if(e.target.value === '' && isOpen) setIsOpen(false);
          }}
          className="border-none background-light800_darkgradient paragraph-regular placeholder text-dark400_light700 shadow-none no-focus outline-hidden "
        />
      </div>
      {isOpen && <GlobalResult />}
    </div>
  );
};

export default GlobalSearch;
