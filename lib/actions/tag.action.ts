 
"use server"

import User from "@/database/user.model";
import { connectToDatabase } from "../mongoose";
import { GetAllTagsParams, GetQuestionsByTagIdParams, GetTopInteractedTagsParams } from "./shared.types";
import Tag, { ITag } from "@/database/tag.model";
import { QueryFilter, type Types } from "mongoose";
import Question from "@/database/question.model";
import Interaction from "@/database/interaction.model";
import { escapeRegExp } from "@/lib/utils";

export async function getTopInteractedTags(params: GetTopInteractedTagsParams) {
    try {
        await connectToDatabase();

        // Default 3: the user card shows a short row of tags (the old
        // stub returned 2). Callers may pass `limit` to ask for more.
        const { userId, limit = 3 } = params;

        const user = await User.findById(userId);

        if(!user) throw new Error("User not found");

        // Most-interacted tags first: count the user's interactions per
        // tag. (Previously this returned a hardcoded [{tag1}, {tag2}].)
        const topTagCounts = (await Interaction.aggregate([
            { $match: { user: user._id } },
            { $unwind: "$tags" },
            { $group: { _id: "$tags", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: limit },
        ])) as Array<{ _id: Types.ObjectId; count: number }>;

        if (topTagCounts.length === 0) return [];

        const tags = await Tag.find({
            _id: { $in: topTagCounts.map((entry) => entry._id) },
        }).select("_id name");

        // Return in interaction order, not database order.
        const byId = new Map(tags.map((tag) => [String(tag._id), tag]));
        return topTagCounts
            .map((entry) => byId.get(String(entry._id)))
            .filter((tag): tag is ITag => tag !== undefined)
            .map((tag) => ({ _id: String(tag._id), name: tag.name }));

    } catch (error) {
        throw error 
    }
}

export async function getAllTags(params: GetAllTagsParams) {
    try {
        await connectToDatabase();

        const { searchQuery, filter, page = 1, pageSize = 10 } = params;
        const skipAmount = (page - 1) * pageSize;

        const query: QueryFilter<typeof Tag> = {};

        if(searchQuery) {
            query.$or = [{name: { $regex: new RegExp(escapeRegExp(searchQuery), 'i') }}]
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
        throw error 
    }
}

export async function getQuesionsByTagId(params: GetQuestionsByTagIdParams) {
    try {

        await connectToDatabase();

        const { tagId, page=1, pageSize = 10, searchQuery} = params;
        const skipAmount = (page - 1) * pageSize;

        const tagFilter : QueryFilter<ITag> = { _id: tagId}

        const tag = await Tag.findOne(tagFilter).populate({
            path: 'questions',
            model: Question,
            match: searchQuery ? {title: { $regex: escapeRegExp(searchQuery), $options: 'i' } } : {},
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
        const questions = tag.questions;

        return { tagTitle: tag.name, questions ,isNext};

    } catch (error) {
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
        throw error 
    }
}
