/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import Question from "@/database/question.model";
import { connectToDatabase } from "../mongoose";
import { SearchParams } from "./shared.types";
import User from "@/database/user.model";
import Answer from "@/database/answer.model";
import Tag from "@/database/tag.model";

const SearchableTypes = ["question", "answer", "user","tag"]

export async function globalSearch(params: SearchParams) {
    try {
       await connectToDatabase();
       
       const { query, type} = params;
       const regexQuery = { $regex: query, $options: "i"};

       let results: any = [];

       const modelsAndTypes = [
        {model: Question, searchField: 'title', type: 'question'},
        {model: User, searchField: 'name', type: 'user'},
        {model: Answer, searchField: 'content', type: 'answer'},
        {model: Tag, searchField: 'name', type: 'tag'},
       ]

       const typeLower = type?.toLowerCase();

       if(!typeLower || !SearchableTypes.includes(typeLower)) {
        for( const { model, searchField, type } of modelsAndTypes) {
            const queryResult = await model.find({
                [searchField]: regexQuery
            }).limit(2);

            results.push(
                ...queryResult.map((item) => ({
                    title: type === 'answer' ? `Answers containing ${query}`: item[searchField],
                    type,
                    id: type === 'user' ? item.clerkId : type === 'answer' ? item.question: item._id   
                }))
            )
        }

       }else {
        // Look the model up by the lowercased type: the raw `type`
        // may be any case ("Question"), and the table keys are lowercase.
        const modelInfo = modelsAndTypes.find((item) => item.type === typeLower)  

        if(!modelInfo) {
            throw new Error(`Invalid search type: ${type}`);
        }

        const queryResult = await modelInfo.model.find({
            [modelInfo.searchField]: regexQuery
        }).limit(8);

        results = queryResult.map((item) => ({
            title: typeLower === 'answer' ? `Answers containing ${query}`: item[modelInfo.searchField],
            type: typeLower,
            id: typeLower === 'user' ? item.clerkId : typeLower === 'answer' ? item.question: item._id
        }))
       }
       
       return JSON.stringify(results);
    } catch (error) {
        throw error;
    }
}
