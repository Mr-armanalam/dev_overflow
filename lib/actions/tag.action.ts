/* eslint-disable spaced-comment */
"use server"

import User from "@/database/user.model";
import { connectToDatabase } from "../mongoose";
import { GetAllTagsParams, GetQuestionsByTagIdParams, GetTopInteractedTagsParams } from "./shared.types";
import Tag, { ITag } from "@/database/tag.model";
import Interaction from "@/database/interaction.model";
import { FilterQuery } from "mongoose";
import Question from "@/database/question.model";

export async function getTopInteractedTags(params: GetTopInteractedTagsParams) {
    try {
        await connectToDatabase();

        const { userId, limit = 3 } = params;

        const user = await User.findById(userId);

        if(!user) throw new Error("User not found");

        // Real aggregation over the user's Interaction records: unwind
        // their tags, count interactions per tag, return the most
        // interacted ones with real Tag names. Returns [] when the
        // user has no interactions — never fake data.
        const topTags = await Interaction.aggregate([
            { $match: { user: user._id } },
            { $unwind: "$tags" },
            { $group: { _id: "$tags", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: limit },
            {
                $lookup: {
                    from: "tags",
                    localField: "_id",
                    foreignField: "_id",
                    as: "tag",
                },
            },
            { $unwind: "$tag" },
            {
                $project: {
                    _id: { $toString: "$tag._id" },
                    name: "$tag.name",
                },
            },
        ]);

        return topTags as { _id: string; name: string }[];
    } catch (error) {
        console.log(error);
        throw error
    }
}

export async function getAllTags(params: GetAllTagsParams) {
    try {
        await connectToDatabase();

        const { searchQuery, filter, page = 1, pageSize = 10 } = params;
        const skipAmount = (page - 1) * pageSize;

        const query: FilterQuery<typeof Tag> = {};

        if(searchQuery) {
            query.$or = [{name: { $regex: new RegExp(searchQuery, 'i') }}]
        }

        let sortOptions = {};

        switch (filter) {
            case 'popular':
                sortOptions = { questions: -1 }
                break;
            case 'recent':
                sortOptions = { createdAt: -1 }
                break;
            case 'name':
                sortOptions = { name: 1 }
                break;
            case 'old':
                sortOptions = { createdAt: 1 }
                break;
            default:
                break;
        }

        const totalTags = await Tag.countDocuments(query);

        const tags = await Tag.find(query)
        .sort(sortOptions)
        .skip(skipAmount)
        .limit(pageSize);

        const isNext = totalTags > skipAmount + tags.length;

        return {tags, isNext}

    } catch (error) {
        console.log(error);
        throw error 
    }
}

export async function getQuesionsByTagId(params: GetQuestionsByTagIdParams) {
    try {

        await connectToDatabase();

        const { tagId, page=1, pageSize = 10, searchQuery} = params;
        const skipAmount = (page - 1) * pageSize;

        const tagFilter : FilterQuery<ITag> = { _id: tagId}

        const tag = await Tag.findOne(tagFilter).populate({
            path: 'questions',
            model: Question,
            match: searchQuery ? {title: { $regex: searchQuery, $options: 'i' } } : {},
            options: {
                sort: {createdAt: -1},
                skip: skipAmount,
                limit: pageSize + 1,  //////////////// +1 to check if there is next page //////////////////
            },
            populate: [
                {path: 'tags', model: Tag, select: "_id name"},
                {path: 'author', model: User, select:'_id clerkId name picture'}
            ]
        }) ;

        if(!tag) {
            throw new Error("Tag not found");
        }

        const isNext = tag.questions.length > pageSize;
        // The populate fetched pageSize + 1 rows to probe for a next
        // page; only return pageSize of them.
        const questions = tag.questions.slice(0, pageSize);

        return { tagTitle: tag.name, questions ,isNext};

        
    } catch (error) {
        console.log(error);
        throw error;
    }
}

export async function getTopPopularTags() {
    try {
        await connectToDatabase();

        const PopularTags = await Tag.aggregate([
            { $project: { name: 1, numberOfQuestions: { $size: "$questions"}}},
            { $sort: { numberOfQuestions: -1}},
            { $limit: 5}
        ])
        return PopularTags;

    } catch (error) {
        console.log(error);
        throw error 
    }
}