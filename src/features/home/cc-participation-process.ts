export type CcParticipationSection = {
  id: string;
  title: string;
  description: string;
  photo: { id: string; url: string; alt: string } | null;
};

export type CcParticipationDocument = {
  title: string;
  introduction: string;
  introductionColor: string;
  sections: CcParticipationSection[];
  bottomText: string;
  version: number;
  canManage: boolean;
};

export const CC_PARTICIPATION_TITLE = 'CC 참여 프로세스';
export const CC_INTRODUCTION_DEFAULT_COLOR = '#475569';
export const CC_MAX_SECTIONS = 5;
export const CC_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
