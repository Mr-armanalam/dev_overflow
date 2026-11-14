import Image from "next/image";
import Link from "next/link";
import React from "react";
import { Button } from "../ui/button";

interface Props {
  title: string;
  description: string;
  link: string;
  linkTitle: string;
}

const NoResult = ({ title, description, link, linkTitle }: Props) => {
  return (
    <div className="mt-10 flex w-full flex-col items-center justify-center">
      <Image
        src={"/assets/images/light-illustration.png"}
        alt="No Results illustrate"
        width={270}
        height={200}
        className="block object-contain dark:hidden"
      />
      <Image
        src={"/assets/images/dark-illustration.png"}
        alt="No Results illustrate"
        width={270}
        height={200}
        className="hidden object-contain dark:flex"
      />

      <h2 className="mt-8 h2-bold text-dark200_light900">{title}</h2>
      <p className="my-3.5 max-w-md text-center body-regular text-dark500_light700">
        {description}
      </p>

      <Link href={link}>
        <Button
          className="mt-5 min-h-[46px] rounded-lg bg-primary-500 px-4 py-3 paragraph-medium text-light-900
         hover:bg-primary-500 dark:bg-primary-500 dark:text-light-900"
        >
          {linkTitle}
        </Button>
      </Link>
    </div>
  );
};

export default NoResult;
