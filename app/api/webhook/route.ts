/* eslint-disable camelcase */
import { Webhook } from "svix";
import { headers } from "next/headers";
import { WebhookEvent } from "@clerk/nextjs/server";
import {
  createUser,
  deleteUser,
  updateUser,
} from "@/lib/actions/user-sync";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  // Server-only variable: the webhook secret must never be exposed
  // to the browser via a NEXT_PUBLIC_* variable.
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    throw new Error(
      "Please add WEBHOOK_SECRET from Clerk Dashboard to .env or .env.local"
    );
  }

  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Error occurred -- no svix headers", {
      status: 400,
    });
  }

  // Verify against the RAW body: Svix signs the raw bytes, and
  // re-serialising JSON (key order / whitespace) can invalidate the
  // signature and reject legitimate Clerk events.
  const body = await req.text();

  // Create a new Svix instance with your secret.
  const wh = new Webhook(WEBHOOK_SECRET);

  let evt: WebhookEvent;

  // Verify the payload with the headers
  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("Error verifying webhook:", err);
    return new Response("Error occurred", {
      status: 400,
    });
  }

//   const { id } = evt.data;
  const eventType = evt.type;
  // console.log(eventType);
  // A Clerk user may have no primary email and no username (e.g. an
  // OAuth sign-up that never set one). Guard both, and build the
  // display name from the parts that exist, so user creation can
  // never crash the webhook on email_addresses[0] / username!.
  const { id, email_addresses, image_url, username, first_name, last_name } =
    evt.data as {
      id?: string;
      email_addresses?: { email_address: string }[];
      image_url: string;
      username?: string | null;
      first_name?: string | null;
      last_name?: string | null;
    };
  const primaryEmail = email_addresses?.[0]?.email_address;
  const safeUsername = username || (id ? `user_${id}` : "user");
  const displayName =
    [first_name, last_name].filter(Boolean).join(" ") || safeUsername;

  if(eventType === 'user.created'){
    if (!id || !primaryEmail) {
      // Cannot create a user without a Clerk id and a primary email
      // (both are required in the User model). Acknowledge so Clerk
      // does not retry a webhook that can never succeed.
      return NextResponse.json({message: 'OK — skipped: no primary email'})
    }

    // Create a new user in your database
    // const mongoUser =
    await createUser({
        clerkId: id,
        name: displayName,
        username: safeUsername,
        email: primaryEmail,
        picture: image_url,
    })

    return NextResponse.json({message: 'OK', username: safeUsername})
  }

  else if(eventType === 'user.updated'){
    if (!id || !primaryEmail) {
      return NextResponse.json({message: 'OK — skipped: no primary email'})
    }

    // Create a new user in your database
    // const mongoUser =
    await updateUser({
        clerkId: id,
        updateData: {
            name: displayName,
            username: safeUsername,
            email: primaryEmail,
            picture: image_url,
        },
        path: `/profile/${id}`

    })

    return NextResponse.json({message: 'OK', username: safeUsername})
  }

  if(eventType === 'user.deleted'){
    if (!id) {
      return new Response("Error occurred -- no user id", { status: 400 });
    }

    const deletedUser = await deleteUser({
        clerkId: id,
    })
     
    return NextResponse.json({message: 'OK', user: deletedUser})
  }

  return NextResponse.json( {message: 'OK'});
}