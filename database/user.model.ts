import {Schema, models, model, Document} from 'mongoose'
import type { UserRole } from "@/lib/auth/permissions";

export interface IUser extends Document { 
    clerkId: string;
    name: string;
    username: string;
    email: string;
    password?: string;
    bio?: string;
    picture?: string;
    location?: string;
    portfolioWebsite?: string;
    reputation?: number;
    /** RBAC role (design §7.2). Synced from Clerk `publicMetadata.role`
     *  by the webhook; absent on users created before roles existed,
     *  which the permission matrix treats as "user". */
    role?: UserRole;
    saved: Schema.Types.ObjectId[];
    joinedAt: Date;
}

const UserSchema = new Schema ({
    clerkId: { type: String, required: true },
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    bio: { type: String },
    picture: { type: String, required: true },
    location: { type: String },
    portfolioWebsite: { type: String },
    reputation: { type: Number, default: 0 },
    role: {
      type: String,
      enum: ["user", "moderator", "admin"],
      default: "user",
    },
    saved: [{ type: Schema.Types.ObjectId, ref: 'Question' }], 
    joinedAt: { type: Date, default: Date.now },
})

const User = models.User || model('User', UserSchema);

export default User;