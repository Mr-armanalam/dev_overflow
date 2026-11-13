'use client'
import React, { useEffect } from 'react'

import Prism from 'prismjs'
import parse from 'html-react-parser'
import DOMPurify from "isomorphic-dompurify"

import "prismjs/components/prism-python";
import "prismjs/components/prism-java";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-aspnet";
import "prismjs/components/prism-sass";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-solidity";
import "prismjs/components/prism-json";
import "prismjs/components/prism-dart";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-r";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-go";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-mongodb";
import "prismjs/plugins/line-numbers/prism-line-numbers.js";
import "prismjs/plugins/line-numbers/prism-line-numbers.css";

interface Props {
    data: string;
}

const ParseHTML = ({data}: Props) => {
    useEffect(()=> {
        Prism.highlightAll();
    }, [])
  return (
    <div className={'markdown w-full min-w-full'}>
        {/* Sanitise before parsing: TinyMCE content is user-supplied HTML
            and may contain <script>, <iframe> or on* event attributes.
            Without this, stored XSS is possible on every question and
            answer page. */}
        {parse(DOMPurify.sanitize(data))}
    </div>
  )
}

export default ParseHTML