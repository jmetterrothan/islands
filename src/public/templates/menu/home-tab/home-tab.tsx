import React from 'react';

import { H1, H2, H3, H4, H5 } from '@public/components/hx/hx';
import Article from '@public/components/article/article';

import { translationSvc } from '@shared/services/translation.service';
import { Biomes } from '@app/world/constants/biomes.constants';
import { achievementSvc } from '@app/achievements/services/achievement.service';

import './home-tab.styles';

import ScreenCapture from '@images/capture.png';

class HomeTab extends React.Component<any, any> {
  render() {
    return (
      <div className='tab home-tab'>
        <header className='tab__header'>
          <H3 className='color-theme mb-2'>{translationSvc.translate('UI.home-tab.title')}</H3>
        </header>
        <div className='tab__content'>
          <Article>
            <H4 className='mb-2'>{translationSvc.translate('UI.home-tab.article.title_project')}</H4>
            <img src={ScreenCapture} alt='Screenshot' className='article__image mb-2' />
            <p className='paragraph mb-2'>{translationSvc.translate('UI.home-tab.article.p1')}</p>
            <p className='paragraph mb-2'>{translationSvc.translate('UI.home-tab.article.p2', { count: Biomes.length })}</p>
            <p className='paragraph mb-3'>{translationSvc.translate('UI.home-tab.article.p3', { count: achievementSvc.getTrophiesCount() })}</p>

            <H4 className='mb-2'>{translationSvc.translate('UI.home-tab.article.title_tech')}</H4>
            <p className='paragraph mb-2'>{translationSvc.translate('UI.home-tab.article.p4')}</p>
            <p className='paragraph mb-3'>{translationSvc.translate('UI.home-tab.article.p5')}</p>
          </Article>
        </div>
      </div>
    );
  }
}

export default HomeTab;
