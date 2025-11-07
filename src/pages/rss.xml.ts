import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { sortByDate } from '../utils/date';

export async function GET(context: any) {
  const blog = await getCollection('blog');
  const sortedPosts = blog.sort(sortByDate);

  return rss({
    title: "Pinkaru's Blog",
    description: 'Code, Science, Philosophy, Humor',
    site: context.site,
    items: sortedPosts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.description,
      link: `/blog/${post.slug}/`,
    })),
    customData: `<language>ko-kr</language>`,
  });
}
