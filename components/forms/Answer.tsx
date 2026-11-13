/* eslint-disable spaced-comment */
/* eslint-disable no-useless-return */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useState } from "react";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "../ui/form";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AnserSchema } from "@/lib/validation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Editor } from "@tinymce/tinymce-react";
import { useTheme } from "@/context/ThemeProvider";
import { Button } from "../ui/button";
import Image from "next/image";
import { createAnswer } from "@/lib/actions/answer.action";
import { usePathname } from "next/navigation";
import DOMPurify from "isomorphic-dompurify";

interface Props {
  question: string;
  questionId: string;
}

// NOTE: the author is derived from the Clerk session inside
// createAnswer — the form no longer sends a user id.
const Answer = ({ question, questionId }: Props) => {
  const pathname = usePathname();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingAI, setIsSubmittingAI] = useState(false);

  const { mode } = useTheme();
  const editorRef = React.useRef(null);
  const form = useForm<z.infer<typeof AnserSchema>>({
    resolver: zodResolver(AnserSchema),
    defaultValues: {
      answer: "",
    },
  }); // follow sadcn

  const handleCreateAnswer = async (values: z.infer<typeof AnserSchema>) => {
    setIsSubmitting(true);

    try {
      await createAnswer({
        content: values.answer,
        question: JSON.parse(questionId),
        path: pathname,
      });

      form.reset();

      if (editorRef.current) {
        const editor = editorRef.current as any;

        editor.setContent("");
      }
    } catch (error) {
      console.log(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const generateAIAnswer = async () => {
    setIsSubmittingAI(true);

    try {
      // Relative URL: the previous NEXT_PUBLIC_SERVER_URL variable was
      // never defined, so this request was built as "undefined/api/chatgpt".
      const response = await fetch("/api/chatgpt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({question})
      })

      const aiAnswer = await response.json();

      ////////////// Convert plain text to HTML format ///////////////////////
      // const formattedAnswer = aiAnswer.reply.replace(/\n/g, '<br />');

      // Sanitise the AI-generated HTML before it enters the editor —
      // model output is untrusted content, same as user input.
      if(editorRef.current && typeof aiAnswer.reply === "string") {
        const editor = editorRef.current as any;
        editor.setContent(DOMPurify.sanitize(aiAnswer.reply));
      }

      // toat....
    } catch (error) {
      console.log(error);
    } finally {
      setIsSubmittingAI(false);
    }
  }

  return (
    <div>
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center sm:gap-2">
        <h4 className="paragraph-semibold text-dark400_light800">
          Write your answer here
        </h4>

        <button
          className="btn light-border-2 flex items-center gap-1.5 rounded-md px-4 py-2.5 
        text-primary-500 shadow-none dark:text-primary-500"
          onClick={generateAIAnswer}
        >
          {isSubmittingAI ? (
            <>
              Generating...
            </>
          ) : (<>
            <Image
            src={"/assets/icons/stars.svg"}
            alt="star"
            width={12}
            height={12}
            className="object-contain"
            />
            Generate AI Answer
          </>)}
        </button>
      </div>
      <Form {...form}>
        <form
          className="mt-6 flex w-full flex-col gap-10"
          onSubmit={form.handleSubmit(handleCreateAnswer)}
        >
          <FormField
            control={form.control}
            name="answer"
            render={({ field }) => (
              <FormItem className="flex w-full flex-col gap-3">
                <FormControl className="mt-3.5">
                  <Editor
                    apiKey={process.env.NEXT_PUBLIC_tINY_EDITOR_API_KEY}
                    // @ts-expect-error " editref not assigned null"
                    onInit={(_evt, editor) => (editorRef.current = editor)}
                    onBlur={field.onBlur}
                    onEditorChange={(content) => field.onChange(content)}
                    init={{
                      height: 350,
                      menubar: false,
                      plugins: [
                        "advlist",
                        "autolink",
                        "lists",
                        "link",
                        "image",
                        "charmap",
                        "anchor",
                        "codesample",
                        "searchreplace",
                        "visualblocks",
                        "fullscreen",
                        "insertdatetime",
                        "media",
                        "table",
                        "preview",
                        "wordcount",
                      ],
                      toolbar:
                        "undo redo | " +
                        "bold codesample italic forecolor | alignleft aligncenter " +
                        "alignright alignjustify | bullist numlist outdent indent | ",
                      content_style:
                        "body { font-family:Inter; font-size:16px }",
                      skin: mode === "dark" ? "oxide-dark" : "oxide",
                      content_css: mode === "dark" ? "dark" : "light",
                    }}
                  />
                  {/* todo add an editor component */}
                </FormControl>
                <FormMessage className="text-red-900" />
              </FormItem>
            )}
          />
          <div className="mt-4 flex justify-end text-white">
            <Button
              type="submit"
              className="primary-gradient w-fit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Submitting..." : "Submit"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};

export default Answer;
