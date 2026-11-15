/* eslint-disable @typescript-eslint/no-explicit-any */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import qs from 'query-string'
import { BADGE_CRITERIA } from "@/constants";
import { BadgeCounts } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const getTimestamp = (createdAt: Date): string => {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - createdAt.getTime()) / 1000);

  let interval = Math.floor(seconds / 31536000);
  if (interval > 1) return `${interval} years ago`;

  interval = Math.floor(seconds / 2592000);
  if (interval > 1) return `${interval} months ago`;

  interval = Math.floor(seconds / 86400);
  if (interval > 1) return `${interval} days ago`;

  interval = Math.floor(seconds / 3600);
  if (interval > 1) return `${interval} hours ago`;

  interval = Math.floor(seconds / 60);
  if (interval > 1) return `${interval} minutes ago`;

  return `${Math.floor(seconds)} seconds ago`;
};

export const formatNumber = (num: number): string => {
  if (num >= 1e6) {
    return `${(num / 1e6).toFixed(1)}M`; // Format for millions
  } else if (num >= 1e3) {
    return `${(num / 1e3).toFixed(1)}K`; // Format for thousands
  } else {
    return num?.toString(); // Return as is for smaller numbers
  }
};

export function getMonthYear(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    month: "long",
    year: "numeric",
  };
  return date.toLocaleDateString("en-US", options);
}


interface UrlQueryParams {
  params: string;
  key: string;
  value: string | null;
};
export const formUrlQuery = ({params, key, value}: UrlQueryParams) => {
  const currentUrl = qs.parse(params);

  currentUrl[key] = value;

  return qs.stringifyUrl({
    url: window.location.pathname,
    query: currentUrl,
  },{ skipNull: true },);
};

interface RemoveUrlQueryParams {
  params: string;
  keysToRemove: string[];
};
export const removeKeysFromQuery = ({params, keysToRemove}: RemoveUrlQueryParams) => {
  const currentUrl = qs.parse(params);

  keysToRemove.forEach((key) => {
    delete currentUrl[key];
  })

  return qs.stringifyUrl({
    url: window.location.pathname,
    query: currentUrl,
  },{ skipNull: true },);
};

interface BadgeParam {
  criteria: {
    type: keyof typeof BADGE_CRITERIA;
    count: number;
  }[];
}

export const assignBadges = (params: BadgeParam) => {
  const badgeCounts : BadgeCounts ={
    GOLD: 0,
    SILVER: 0,
    BRONZE: 0,
  }
  const { criteria } = params;

  criteria.forEach(( item ) => {
    const { type, count } = item;
    const badgeLevels = BADGE_CRITERIA[type];

    Object.keys(badgeLevels).forEach((level: any) => {
      if(count >= badgeLevels[level as keyof BadgeCounts]) {
        badgeCounts[level as keyof BadgeCounts] += 1;
      }
    })
  }) 
  return badgeCounts;
}

export const formatAIGeneratedText = (aiText: any) => {
  const lines = aiText.split("\n");
  let formattedText = "";

  lines.forEach((line: any) => {
    if (line.startsWith('**') && line.endsWith('**')) {  
      formattedText += `<h3>${line.replace(/\*\*/g, '')}</h3>\n`; 
    } else if (line.startsWith('* **Using')) { 
      formattedText += `<h4>${line.replace('* **Using', '').replace('**:', '')}</h4>\n`; 
    } else if (line.startsWith(' * ')) { 
      formattedText += `<ul><li>${line.replace(' * ', '')}</li></ul>\n`; 
    } else if (line.startsWith(' ')) { 
      formattedText += `<pre><code>${line.trim()}</code></pre>\n`; 
    } else if (line.trim() === '') {  
      formattedText += `<br/>`; 
    } else {
      formattedText += `<p>${line.trim()}</p>\n`}
    });

  return formattedText;
};
/**
 * Escape a user-supplied string for safe use inside a RegExp (or a
 * MongoDB $regex). Without this, a search term containing regex syntax
 * such as `(`, `[` or `.*` either throws (invalid pattern) or matches
 * far more than the literal text.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
