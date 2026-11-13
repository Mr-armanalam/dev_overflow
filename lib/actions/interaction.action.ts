 
'use server'

import Question from "@/database/question.model";
import { connectToDatabase } from "../mongoose";
import { ViewQuestionParams } from "./shared.types";
import Interaction from "@/database/interaction.model";


export async function viewQuestion (params: ViewQuestionParams) {
    try {
        await connectToDatabase();

        const { questionId, userId} = params;

        // A view is counted at most once per signed-in user. Check the
        // dedup record BEFORE incrementing — previously the $inc ran
        // first, so every page load inflated the count. Anonymous
        // visitors are not counted (callers only invoke this for
        // signed-in users, once per question-page load).
        if (userId) {
            const existingInteraction = await Interaction.findOne({ user: userId, action: 'view', question: questionId });

            if(existingInteraction) return;

            //////////// create interaction //////////

            await Interaction.create({
                user: userId,
                action: 'view',
                question: questionId,
            })

            /////////// update view count for the question //////////////

            await Question.findByIdAndUpdate(questionId, { $inc: {views: 1}});
        }
        
    } catch (error) {
        console.log(error);
        throw error;       
    }
}
