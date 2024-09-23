/**
 * Share command metadata from a common spot to be used for both runtime
 * and registration.
 */

export const AWW_COMMAND = {
  name: 'awwww',
  description: 'Drop some cuteness on this channel.',
};

export const INVITE_COMMAND = {
  name: 'invite',
  description: 'Get an invite link to add the bot to your server',
};

// simple calculator command
export const CALCULATE_COMMAND = {
  name: 'calculate',
  description: 'Perform a calculation',
  options: [
    {
      name: 'expression',
      type: 3, // STRING type
      description: 'The expression to calculate',
      required: true,
    },
  ],
};

// wojak command
export const WOJAK_COMMAND = {
  name: 'wojak',
  description: 'Overlays the funny pointing guys',
};