const MS_ONE_SECOND = 1000;
const MS_ONE_MINUTE = 60 * MS_ONE_SECOND;
const MS_ONE_HOUR = 60 * MS_ONE_MINUTE;
const MS_ONE_DAY = 24 * MS_ONE_HOUR;
const MS_ONE_WEEK = 7 * MS_ONE_DAY;
const MS_ONE_MONTH = 31 * MS_ONE_DAY;
const MS_ONE_YEAR = 365 * MS_ONE_DAY;

function getTimeDurationMs({
  seconds = 0,
  minute = 0,
  hour = 0,
  day = 0,
  week = 0,
  month = 0,
  year = 0,
}: {
  seconds?: number;
  minute?: number;
  hour?: number;
  day?: number;
  week?: number;
  month?: number;
  year?: number;
}) {
  return (
    seconds * MS_ONE_SECOND +
    minute * MS_ONE_MINUTE +
    hour * MS_ONE_HOUR +
    day * MS_ONE_DAY +
    week * MS_ONE_WEEK +
    month * MS_ONE_MONTH +
    year * MS_ONE_YEAR
  );
}

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const timeout = <T>(p: Promise<T>, ms: number, message?: string) =>
  new Promise<T>((resolve, reject) => {
    setTimeout(() => reject(new Error(message || 'Timeout')), ms);
    p.then((value) => resolve(value)).catch((err) => reject(err));
  });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const sleepUntil = ({
  conditionFn,
  until,
}: {
  conditionFn: () => boolean;
  until: number;
}) =>
  new Promise((resolve) => {
    const startAt = Date.now();
    const checkCondition = () => {
      const conditionMet = conditionFn();
      if (conditionMet || Date.now() - startAt > until) {
        resolve(true);
        return;
      }

      setTimeout(checkCondition, 100);
    };
    checkCondition();
  });

export default {
  timeout,
  wait,
  getTimeDurationMs,
};
