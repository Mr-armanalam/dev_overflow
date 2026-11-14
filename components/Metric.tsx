import Image from "next/image";
import Link from "next/link";
import React from "react";

interface MetricProps {
  imgUrl: string;
  alt: string;
  value: number | string;
  title: string;
  href?: string;
  textStyles?: string;
  isAuthor?: boolean;
}

const Metric = ({
  imgUrl,
  alt,
  value,
  title,
  href,
  textStyles,
  isAuthor,
}: MetricProps) => {
  const metricContent = (
    <>
      <Image
        src={imgUrl}
        width={16}
        height={16}
        alt={alt}
        className={`object-contain ${href ? "rounded-full" : ""}`}
      />

      <p className={`flex items-center gap-1 ${textStyles}`}>
        {value}
        <span
          className={`line-clamp-1 small-regular ${isAuthor ? "max-sm:hidden" : ""}`}
        >
          {" "}
          {title}
        </span>
      </p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="flex items-center gap-1">
        {metricContent}
      </Link>
    );
  }

  return <div className="flex-center flex-wrap gap-1">
    {metricContent}
  </div>;
};

export default Metric;
