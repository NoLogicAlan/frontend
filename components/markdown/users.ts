import { Accessor, createMemo } from "solid-js";

import { useClient } from "@revolt/client";
import { useParams } from "@revolt/routing";

// TODO: move to @revolt/common?

/**
 * Resolved user information
 */
interface UserInformation {
  /**
   * Username or nickname
   */
  username: string;

  /**
   * Avatar or server profile avatar
   */
  avatar?: string;

  /**
   * Role colour
   */
  colour?: string | null;
}

/**
 * Resolve multiple users by their ID within the current context
 * @param ids User IDs
 * @returns User information
 */
export function useUsers(
  ids: string[]
): Accessor<(UserInformation | undefined)[]> {
  const client = useClient();

  // TODO: use a context here for when we do multi view :)
  const { server } = useParams<{ server: string }>();

  return createMemo(() =>
    ids.map((id) => {
      const user = client.users.get(id)!;

      if (user) {
        if (server) {
          const member = client.members.getKey({ server, user: user._id });
          if (member) {
            return {
              username: member.nickname ?? user.username,
              avatar: member.animatedAvatarURL ?? user.animatedAvatarURL,
              colour: member.roleColour,
            };
          }
        }

        return {
          username: user.username,
          avatar: user.animatedAvatarURL,
        };
      }
    })
  );
}

export function useUser(id: string): Accessor<UserInformation | undefined> {
  const users = useUsers([id]);
  return () => users()[0];
}
