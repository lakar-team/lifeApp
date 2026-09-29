// functions/api/me.js
// Returns current authenticated user info
// Validates the session cookie server-side and returns user details

import { getSessionToken, getUser, isCreator, json } from '../_lib/auth.js';

export async function onRequestGet(context) {
    const { request, env } = context;

    try {
        const user = await getUser(env, getSessionToken(request));
        if (!user) {
            return json({ authenticated: false });
        }

        return json({
            authenticated: true,
            id: user.id,
            email: user.email ? user.email.toLowerCase() : '',
            isCreator: await isCreator(env, user)
        });
    } catch (err) {
        console.error('API /me error:', err.message);
        return json({ authenticated: false });
    }
}
