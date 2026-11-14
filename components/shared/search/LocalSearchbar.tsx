"use client";
import { Input } from "@/components/ui/input";
import { formUrlQuery, removeKeysFromQuery } from "@/lib/utils";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useState } from "react";

interface CustomInputProps {
  route: string;
  iconPosition: string;
  imgSrc: string;
  placeholder: string;
  otherClasses?: string;
}

const LocalSearchbar = ({
  route,
  iconPosition,
  imgSrc,
  placeholder,
  otherClasses,
}: CustomInputProps) => {

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = searchParams.get('q');

  const [search, setSearch] = useState(query || '');

  useEffect(()=>{
    const delayDebounceFn = setTimeout(()=>{
      // Guard: Next has no same-URL bailout — pushing the URL we are
      // already on re-renders the page and re-fires this effect (the
      // fresh useSearchParams() object is a dependency), so only
      // navigate when the target actually differs.
      const currentUrl = window.location.pathname + window.location.search;
      if (search) {
        const newUrl = formUrlQuery({
          params: searchParams.toString(),
          key: 'q',
          value: search
        })

        if (newUrl !== currentUrl) router.push(newUrl, { scroll: false});
      } else {
        if(pathname === route) {
          const newUrl = removeKeysFromQuery({
            params: searchParams.toString(),
            keysToRemove: ['q']
          })
          if (newUrl !== currentUrl) router.push(newUrl, { scroll: false});
        }
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);  

  },[search, route, pathname, router, searchParams, query])

  return (
    <div
      className={`flex min-h-14 grow items-center gap-4 rounded-[10px] background-light800_darkgradient px-4
    ${otherClasses}`}
    >
      {iconPosition === "left" && (
        <Image
          src={imgSrc}
          alt="search icon"
          width={24}
          height={24}
          className="cursor-pointer"
        />
      )}

      <Input
        type="text"
        placeholder={placeholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="border-none background-light800_darkgradient paragraph-regular placeholder shadow-none no-focus outline-hidden"
      />

      {iconPosition === "right" && (
        <Image
          src={imgSrc}
          alt="search icon"
          width={24}
          height={24}
          className="cursor-pointer"
        />
      )}
    </div>
  );
};

export default LocalSearchbar;
