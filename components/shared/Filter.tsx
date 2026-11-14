'use client'
import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SelectGroup } from "@radix-ui/react-select";
import { formUrlQuery } from "@/lib/utils";
import { useRouter, useSearchParams } from "next/navigation";

interface Props {
  filters: { name: string; value: string }[];
  otherClasses?: string;
  containerClass?: string;
}

const Filter = ({ filters, otherClasses, containerClass }: Props) => {

  const searchParams = useSearchParams();
  const router = useRouter();

  const paramFilter = searchParams.get('filter');

  const handleUpdateParams = (value: string) => {
    const newUrl = formUrlQuery({
      params: searchParams.toString(),
      key: 'filter',
      value
    })
    router.push(newUrl, { scroll: false });
  };

  return (
    <div className={`relative ${containerClass}`}>
      <Select 
          onValueChange={handleUpdateParams} 
          defaultValue={paramFilter || undefined}  
        >
        <SelectTrigger className={`${otherClasses} border light-border background-light800_dark300 px-5 py-2.5 body-regular text-dark500_light700`}>
            <div className="line-clamp-1 flex-1 text-left">
                <SelectValue placeholder="Select a Filter" />
            </div>
         
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {filters.map((item) =>(
                <SelectItem key={item.value} value={item.value}>
                    {item.name}
                </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
};

export default Filter;
