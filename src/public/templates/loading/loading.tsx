import React from 'react';

import './loading.scss';

const Loading = () => (
  <section className='ui__state loading'>
    <div className='loading__message'>
      <p className='mb-2'>loading</p>
      <ul className='loading__animation'>
        <li />
        <li />
        <li />
      </ul>
    </div>
  </section>
);

export default Loading;