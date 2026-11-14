 
import { Schema, model, models, Document } from "mongoose";

export interface IInteraction extends Document {
  user: Schema.Types.ObjectId;
  action: string;
  // Singular field names — these must match every writer/reader
  // (interaction.action.ts, answer.action.ts, question.action.ts).
  // The previous plural names (questions/answers) were silently dropped
  // by Mongoose strict mode, so views and recommendations were broken.
  question: Schema.Types.ObjectId;
  answer: Schema.Types.ObjectId;
  tags: Schema.Types.ObjectId[];
  createdAt: Date;
}

const InteractionSchema = new Schema<IInteraction>({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, required: true },
  question: { type: Schema.Types.ObjectId, ref: "Question" },
  answer: { type: Schema.Types.ObjectId, ref: "Answer" },
  tags: [{ type: Schema.Types.ObjectId, ref: "Tag" }],
  createdAt: { type: Date, default: Date.now },
});

const Interaction =
  models.Interaction || model<IInteraction>("Interaction", InteractionSchema);

export default Interaction;
