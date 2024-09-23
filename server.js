/**
 * The core server that runs on a Cloudflare worker.
 */

import { AutoRouter } from 'itty-router';
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import { AWW_COMMAND, INVITE_COMMAND, CALCULATE_COMMAND, WOJAK_COMMAND } from './commands.js';
import { getCuteUrl } from './reddit.js';
import { InteractionResponseFlags } from 'discord-interactions';

class JsonResponse extends Response {
  constructor(body, init) {
    const jsonBody = JSON.stringify(body);
    init = init || {
      headers: {
        'content-type': 'application/json;charset=UTF-8',
      },
    };
    super(jsonBody, init);
  }
}

const router = AutoRouter();

/**
 * A simple :wave: hello page to verify the worker is working.
 */
router.get('/', (request, env) => {
  return new Response(`👋 ${env.DISCORD_APPLICATION_ID}`);
});

/**
 * Main route for all requests sent from Discord.  All incoming messages will
 * include a JSON payload described here:
 * https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object
 */
 
// Function for fetching last image message
async function fetchLastImageMessage(channelId, token) {
  const url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=1`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bot ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch the last message.');
  }

  const messages = await response.json();
  const lastMessage = messages[0];

  // Check if the last message contains an image in attachments or embeds
  let imageUrl = null;

  if (lastMessage.attachments && lastMessage.attachments.length > 0) {
    // Check attachments for images
    imageUrl = lastMessage.attachments.find(attachment => attachment.content_type.startsWith('image/'))?.url;
  }

  if (!imageUrl && lastMessage.embeds && lastMessage.embeds.length > 0) {
    // Check embeds for images
    imageUrl = lastMessage.embeds.find(embed => embed.type === 'image')?.url;
  }

  if (!imageUrl) {
    throw new Error('No image found in the last message.');
  }

  return imageUrl;
}

// Upload images to imgur
async function uploadToImgur(imageUrl) {
  const clientId = '7afa12a3c4229af';
  const uploadUrl = 'https://api.imgur.com/3/image';

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Client-ID ${clientId}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image: imageUrl,
      type: 'url',  // Upload via URL
    }),
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error('Failed to upload image to Imgur');
  }

  return {
    imgurUrl: result.data.link,    // The URL of the uploaded image
    width: result.data.width,      // Image width
    height: result.data.height,    // Image height
  };
}

// Function for safely evaluating math without throwing error
function evaluateExpression(expression) {
  // Remove all whitespace from the expression
  expression = expression.replace(/\s+/g, '');

  // Use a regular expression to check for valid characters (digits and basic operators)
  const validExpression = /^[0-9+\-*/().]+$/.test(expression);
  if (!validExpression) {
    throw new Error('Invalid characters in the expression.');
  }

  // Implement a safe evaluator for basic arithmetic
  try {
    // Basic arithmetic evaluation using the `math` method from JavaScript
    return basicArithmeticParser(expression);
  } catch (error) {
    throw new Error('Error in expression evaluation.');
  }
}

function basicArithmeticParser(expression) {
  // Supported operators: +, -, *, /
  let tokens = expression.match(/(\d+|\+|\-|\*|\/|\(|\))/g);
  if (!tokens) throw new Error('Invalid expression');
  
  let stack = [];
  let operators = [];

  const precedence = {
    '+': 1,
    '-': 1,
    '*': 2,
    '/': 2,
  };

  const applyOperator = () => {
    const operator = operators.pop();
    const b = stack.pop();
    const a = stack.pop();

    switch (operator) {
      case '+': stack.push(a + b); break;
      case '-': stack.push(a - b); break;
      case '*': stack.push(a * b); break;
      case '/': stack.push(a / b); break;
      default: throw new Error('Unknown operator');
    }
  };

  for (let token of tokens) {
    if (!isNaN(token)) {
      // If token is a number, push it to the stack
      stack.push(Number(token));
    } else if (token in precedence) {
      // If token is an operator, apply any operators with higher or equal precedence
      while (operators.length && precedence[operators[operators.length - 1]] >= precedence[token]) {
        applyOperator();
      }
      operators.push(token);
    } else if (token === '(') {
      operators.push(token);
    } else if (token === ')') {
      // Apply operators until we find the matching '('
      while (operators[operators.length - 1] !== '(') {
        applyOperator();
      }
      operators.pop(); // Remove the '('
    }
  }

  // Apply any remaining operators
  while (operators.length) {
    applyOperator();
  }

  // The result is the remaining value on the stack
  return stack.pop();
}


router.post('/', async (request, env) => {
  const { isValid, interaction } = await server.verifyDiscordRequest(
    request,
    env,
  );
  if (!isValid || !interaction) {
    return new Response('Bad request signature.', { status: 401 });
  }

  if (interaction.type === InteractionType.PING) {
    // The `PING` message is used during the initial webhook handshake, and is
    // required to configure the webhook in the developer portal.
    return new JsonResponse({
      type: InteractionResponseType.PONG,
    });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    // Most user commands will come as `APPLICATION_COMMAND`.
    switch (interaction.data.name.toLowerCase()) {
      case AWW_COMMAND.name.toLowerCase(): {
        const cuteUrl = await getCuteUrl();
        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: cuteUrl,
          },
        });
      }
	  case WOJAK_COMMAND.name.toLowerCase(): {
        try {
          const channelId = interaction.channel_id;
          const token = env.DISCORD_TOKEN;

          // Fetch the last image message from the channel
          const lastImageUrl = await fetchLastImageMessage(channelId, token);
		  
		  // Upload the image to Imgur and get its dimensions
          const { imgurUrl, width, height } = await uploadToImgur(lastImageUrl);

          // Cloudinary transformation URL
          const cloudinaryUrl = `https://res.cloudinary.com/dtqcejpbc/image/fetch/l_IfIpVKM_c4gttl/c_scale,h_${height},w_${width}/fl_layer_apply/${imgurUrl}`;

          // Return the overlaid image URL
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `\n${cloudinaryUrl}`,
            },
          });
        } catch (error) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `Error fetching or overlaying the image: ${error.message}`,
            },
          });
        }
	  }
      case INVITE_COMMAND.name.toLowerCase(): {
        const applicationId = env.DISCORD_APPLICATION_ID;
        const INVITE_URL = `https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=applications.commands`;
        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: INVITE_URL,
            flags: InteractionResponseFlags.EPHEMERAL,
          },
        });
      }
	  case CALCULATE_COMMAND.name.toLowerCase(): {
		const expression = interaction.data.options[0].value;
        try {
          const result = evaluateExpression(expression); // Use parser
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `The result is ${result}` },
          });
        } catch (error) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: `Error calculating the expression: ${error.message}` },
          });
        }
	  }
      default:
        return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
    }
  }

  console.error('Unknown Type');
  return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
});
router.all('*', () => new Response('Not Found.', { status: 404 }));

async function verifyDiscordRequest(request, env) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.text();
  const isValidRequest =
    signature &&
    timestamp &&
    (await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY));
  if (!isValidRequest) {
    return { isValid: false };
  }

  return { interaction: JSON.parse(body), isValid: true };
}

const server = {
  verifyDiscordRequest,
  fetch: router.fetch,
};

export default server;
