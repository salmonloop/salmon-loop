import { Logger } from '../../src/core/logger.js';

describe('Logger', () => {
  let logger: Logger;
  let consoleSpy: any;

  beforeEach(() => {
    logger = new Logger();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* ignore */
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {
      /* ignore */
    });
    vi.spyOn(console, 'error').mockImplementation(() => {
      /* ignore */
    });
  });

  it('should not log debug/trace by default', () => {
    logger.debug('debug message');
    logger.trace('trace message');
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('should log debug but not trace in basic mode', () => {
    logger.setVerbose('basic');
    logger.debug('debug message');
    logger.trace('trace message');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('debug message'));
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('trace message'));
  });

  it('should log both debug and trace in extended mode', () => {
    logger.setVerbose('extended');
    logger.debug('debug message');
    logger.trace('trace message');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('debug message'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('trace message'));
  });

  it('should handle boolean true as basic mode', () => {
    logger.setVerbose(true);
    logger.debug('debug message');
    logger.trace('trace message');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('debug message'));
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('trace message'));
  });

  it('should handle boolean false as none mode', () => {
    logger.setVerbose(false);
    logger.debug('debug message');
    logger.trace('trace message');
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
