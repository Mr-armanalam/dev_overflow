/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable spaced-comment */
/* eslint-disable import/no-duplicates */
"use client";
import React, { useRef, useState } from "react";
import { Editor } from "@tinymce/tinymce-react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage, } from "@/components/ui/form";

import { Input } from "@/components/ui/input";
import { QuestionSchema } from "@/lib/validation";
import { Badge } from "../ui/badge";
import Image from "next/image";
import { createQuestion, editQuestion } from "@/lib/actions/question.action";
import { usePathname} from "next/navigation";
import { useRouter } from 'next/navigation'
import { useTheme } from "@/context/ThemeProvider";


interface Props {
  type?: string;
  questionDetails?: string;
}

// NOTE: the author is derived from the Clerk session inside
// createQuestion — the form no longer sends a user id.
const Question = ({type, questionDetails}: Props) => {

  const { mode } = useTheme(); 
  const editorRef = useRef(null);
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [isSuggestingTags, setIsSuggestingTags] = useState(false);
  const [tagSuggestError, setTagSuggestError] = useState<string | null>(null);
  const pathname = usePathname();

  const parsedQuestionDetails = questionDetails && JSON.parse(questionDetails || '');
  const groupedTags = parsedQuestionDetails?.tags.map((tag:any) => tag.name);

  const form = useForm<z.infer<typeof QuestionSchema>>({
    resolver: zodResolver(QuestionSchema),
    defaultValues: {
      title: parsedQuestionDetails?.title || "",
      explanation: parsedQuestionDetails?.content || '',
      tags: groupedTags || [],
    },
  });

  async function onSubmit(values: z.infer<typeof QuestionSchema>) {
    setIsSubmitting(true);

    try {
      
      if(type === 'Edit'){
        await editQuestion({
          questionId: parsedQuestionDetails?._id,
          title: values.title,
          content: values.explanation, 
          path: pathname
        })
        router.push(`/question/${parsedQuestionDetails?._id}`);

      } else {
        await createQuestion({
          title: values.title,
          content: values.explanation,
          tags: values.tags,
          path:pathname
        });
        ///////////// navigate to home page ////////////////  

        router.push('/');
      }
     
    } catch (error) {
      console.log(error);
    } finally {
      setIsSubmitting(false);
    }

  }

  const handleInputKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    field: any
  ) => {
    if (e.key === "Enter" && field?.name === "tags") {
      e.preventDefault();
      const tagInput = e.target as HTMLInputElement;
      const tagValue = tagInput.value.trim();

      if (tagValue !== "") {
        if (tagValue.length > 15) {
          return form.setError("tags", {
            type: "required",
            message: "Tag must be less than 15 characters",
          });
        }

        if (!field.value.includes(tagValue as never)) {
          form.setValue("tags", [...field.value, tagValue]);
          tagInput.value = "";
          form.clearErrors("tags");
        } else {
          form.trigger();
        }
      }
    }
  };

  const handleTagRemove = (tag: string, field: any) => {
    const newTags = field.value.filter((t: string) => t !== tag);
    form.setValue("tags", newTags);
  };

  // Suggested tags are never auto-applied: the user confirms each chip.
  const stripHtml = (html: string): string =>
    html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const suggestTags = async () => {
    const title = form.getValues("title")?.trim() ?? "";
    const body = stripHtml(form.getValues("explanation") ?? "");
    if (title.length < 5 || body.length < 20) {
      setTagSuggestError("Add a title and a short description first.");
      return;
    }
    setIsSuggestingTags(true);
    setTagSuggestError(null);
    try {
      const response = await fetch("/api/ai/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setTagSuggestError(
          (data as { error?: string } | null)?.error ??
            "Tag suggestion failed. Please try again."
        );
        return;
      }
      const tags = (data as { tags?: unknown } | null)?.tags;
      setSuggestedTags(
        Array.isArray(tags)
          ? tags.filter((t): t is string => typeof t === "string")
          : []
      );
    } catch (error) {
      console.log(error);
      setTagSuggestError("Tag suggestion failed. Please try again.");
    } finally {
      setIsSuggestingTags(false);
    }
  };

  const addSuggestedTag = (tag: string, field: { value: string[] }) => {
    if (field.value.length >= 3 || field.value.includes(tag)) return;
    form.setValue("tags", [...field.value, tag]);
    form.clearErrors("tags");
    setSuggestedTags((prev) => prev.filter((t) => t !== tag));
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex w-full flex-col gap-10"
      >
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem className="flex w-full flex-col">
              <FormLabel className="paragraph-semibold text-dark400_light800">
                Question Title
                <span className="text-primary-500">*</span>
              </FormLabel>
              <FormControl className="mt-3.5">
                <Input
                  className="no-focus paragraph-regular background-light900_dark300 light-border-2 text-dark300_light700 min-h-[56px] border"
                  {...field}
                />
              </FormControl>
              <FormDescription className="body-regular mt-2.5 text-light-500">
                Be specific and imagine you&apos;re asking a question to another
                person.
              </FormDescription>
              <FormMessage className="text-red-900" />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="explanation"
          render={({ field }) => (
            <FormItem className="flex w-full flex-col gap-3">
              <FormLabel className="paragraph-semibold text-dark400_light800">
                Detailed explanation of your problem
                <span className="text-primary-500">*</span>
              </FormLabel>
              <FormControl className="mt-3.5">
                <Editor
                  apiKey={process.env.NEXT_PUBLIC_tINY_EDITOR_API_KEY}
                  // @ts-expect-error " current"
                  onInit={(_evt, editor) => (editorRef.current = editor)}
                  onBlur={field.onBlur}
                  onEditorChange={(content) => field.onChange(content)}
                  initialValue={parsedQuestionDetails?.content || ''}
                  init={{
                    height: 350,
                    menubar: false,
                    plugins: [ "advlist", "autolink", "lists", "link", "image", "charmap", "anchor", "codesample", "searchreplace", 
                    "visualblocks", "fullscreen", "insertdatetime", "media", "table", "preview", "help", "wordcount" ],

                    toolbar:"undo redo | blocks | " + "bold codesample italic forecolor | alignleft aligncenter " +
                      "alignright alignjustify | bullist numlist outdent indent | " + "removeformat | help",

                    content_style: "body { font-family:Inter; font-size:16px }",
                    skin: mode === 'dark' ? 'oxide-dark' : 'oxide',
                    content_css: mode === 'dark' ? 'dark' : 'light',
                  }}
                />               
              </FormControl>
              
              <FormDescription className="body-regular mt-2.5 text-light-500">
                Introduce the problem and expand on what you put in the title.
                Minimum 20 characters
              </FormDescription>
              <FormMessage className="text-red-900" />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="tags"
          render={({ field }) => (
            <FormItem className="flex w-full flex-col">
              <FormLabel className="paragraph-semibold text-dark400_light800">
                Tags
                <span className="text-primary-500">*</span>
              </FormLabel>
              <FormControl className="mt-3.5">
                <div>
                  <Input
                    disabled={type === 'Edit'}
                    className="no-focus paragraph-regular background-light900_dark300 light-border-2 text-dark300_light700 min-h-[56px] border"
                    placeholder="Add tags..."
                    onKeyDown={(e) => handleInputKeyDown(e, field)}
                  />

                  {field.value.length > 0 && (
                    <div className="flex-start mt-2.5 gap-2.5">
                      {field.value.map((tag: any) => (
                        <Badge
                          key={tag}
                          className="subtle-medium background-light800_dark300 text-light400_light500 
                        flex items-center justify-center gap-2 rounded-md border-none px-4 py-2 capitalize"
                          onClick={() => type !== 'Edit' ? handleTagRemove(tag, field) : () => {}}
                        >
                          {tag}
                          {type !== 'Edit' && (
                            <Image
                            src={"/assets/icons/close.svg"}
                            alt="close icon"
                            width={12}
                            height={12}
                            className="cursor-pointer object-contain invert-0 dark:invert"
                          />
                          )}
                          
                        </Badge>
                      ))}
                    </div>
                  )}

                  {type !== 'Edit' && (
                    <div className="mt-2.5">
                      <button
                        type="button"
                        onClick={suggestTags}
                        disabled={isSuggestingTags}
                        className="btn light-border-2 flex items-center gap-1.5 rounded-md px-3 py-2 text-primary-500 shadow-none dark:text-primary-500"
                      >
                        <Image
                          src={"/assets/icons/stars.svg"}
                          alt="star"
                          width={12}
                          height={12}
                          className="object-contain"
                        />
                        {isSuggestingTags ? "Suggesting…" : "Suggest tags"}
                      </button>
                      {suggestedTags.length > 0 && (
                        <div className="flex-start mt-2.5 gap-2.5">
                          {suggestedTags.map((tag) => (
                            <Badge
                              key={tag}
                              className="subtle-medium background-light800_dark300 text-light400_light500 flex cursor-pointer items-center justify-center gap-2 rounded-md border-none px-4 py-2 capitalize"
                              onClick={() => addSuggestedTag(tag, field)}
                            >
                              + {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {tagSuggestError && (
                        <p className="body-regular mt-2 text-red-500">
                          {tagSuggestError}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </FormControl>
              <FormDescription className="body-regular mt-2.5 text-light-500">
                Add up to 3 tags to describe what your question is about. You
                need to press enter to add a tag.
              </FormDescription>
              <FormMessage className="text-red-900" />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          className="primary-gradient w-fit !text-light-900"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>{type === "Edit" ? "Editing..." : "Posting..."}</>
          ) : (
            <>{type === "Edit" ? "Edit Question" : "Ask a Question"}</>
          )}
        </Button>
      </form>
    </Form>
  );
};

export default Question;
