import React from 'react';

import { getMessageLevel, type Message } from '../../store/types.js';
import { shouldShowSeparator } from '../../styles/theme.js';

import { EmphasisMessageItem } from './items/EmphasisMessageItem.js';
import { InterruptMessageItem } from './items/InterruptMessageItem.js';
import { LightweightMessageItem } from './items/LightweightMessageItem.js';
import { StandardMessageItem } from './items/StandardMessageItem.js';
import { WelcomeMessageItem } from './items/WelcomeMessageItem.js';
import type { MessageRenderContext } from './types.js';

export const MessageItem = React.memo<{
  msg: Message;
  nextMsg?: Message;
  ctx: MessageRenderContext;
}>(({ msg, nextMsg, ctx }) => {
  if (msg.type === 'welcome' || msg.content === 'WELCOME_LOGO') {
    return <WelcomeMessageItem />;
  }

  if (msg.type === 'interrupt' || msg.content.includes('^C [SPLATTED]')) {
    return (
      <InterruptMessageItem
        msg={msg}
        markdownTheme={ctx.markdownTheme}
        markdownRenderMode={ctx.markdownRenderMode}
        containerWidth={ctx.containerWidth}
      />
    );
  }

  const level = getMessageLevel(msg.type);
  const showSeparator = shouldShowSeparator(msg.type, nextMsg?.type);

  if (level === 'emphasis') {
    return <EmphasisMessageItem msg={msg} ctx={ctx} showSeparator={showSeparator} />;
  }

  if (level === 'standard') {
    return <StandardMessageItem msg={msg} ctx={ctx} showSeparator={showSeparator} />;
  }

  return <LightweightMessageItem msg={msg} ctx={ctx} />;
});
